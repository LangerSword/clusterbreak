import type { Device, Model, Quant } from "../sim";
import pricing from "../../../sim/data/aws-pricing.json";
import sizes from "../../../sim/data/model-sizes.json";

/**
 * Deploy kit — turns a simulated rig into a real, deployable CloudFormation
 * template (VPC + subnet + IGW + security group + one EC2 node per NVIDIA
 * device, llama.cpp served via Docker in userdata).
 *
 * Honesty rules (same as everything else in this repo):
 *  - costs come from the vendored AWS Pricing API snapshot (`tools/refresh_pricing.py`),
 *    never typed by hand; the snapshot date is surfaced.
 *  - the model URL is built from the Hugging Face-verified repo + file name in
 *    `model-sizes.json`; if we don't have them, no default is invented.
 *  - cloud GPU silicon differs from consumer cards — mappings say so out loud.
 */

export const PRICING_FETCHED_AT: string = pricing.fetchedAt;
export const PRICING_REGION: string = pricing.region;

interface PriceInfo {
  onDemandUsdPerHour: number | null;
  spotUsdPerHour: number | null;
}

export interface DeployPlanEntry {
  device: Device;
  instanceType: string;
  reason: string;
}

export interface DeployPlan {
  entries: DeployPlanEntry[];
  skipped: { device: Device; reason: string }[];
}

/** Nearest EC2 instance for a device — or null when the hardware doesn't exist on EC2. */
export function instanceForDevice(d: Device): { instanceType: string; reason: string } | null {
  if (d.vendor !== "NVIDIA") {
    return null;
  }
  if (d.memoryGb >= 40) {
    return { instanceType: "g6e.xlarge", reason: "nearest EC2 GPU class (L40S, 48 GB)" };
  }
  if (d.memoryGb >= 30) {
    return {
      instanceType: "g6e.xlarge",
      reason: "nearest EC2 GPU class (L40S, 48 GB) — cloud silicon differs from consumer cards, so tok/s will differ",
    };
  }
  if (d.memoryGb >= 20) {
    return {
      instanceType: "g5.xlarge",
      reason: "same VRAM class (A10G, 24 GB) — cloud silicon differs, expect different tok/s",
    };
  }
  if (d.memoryGb >= 12) {
    return { instanceType: "g4dn.xlarge", reason: "nearest small EC2 GPU (T4, 16 GB)" };
  }
  return {
    instanceType: "g4dn.xlarge",
    reason: "no small-GPU EC2 class — the T4 has more VRAM than this node",
  };
}

export function planDeploy(devices: Device[]): DeployPlan {
  const entries: DeployPlanEntry[] = [];
  const skipped: { device: Device; reason: string }[] = [];
  for (const d of devices) {
    const m = instanceForDevice(d);
    if (m) entries.push({ device: d, ...m });
    else
      skipped.push({
        device: d,
        reason: `${d.vendor} hardware is not offered on EC2 (unified-memory / laptop parts)`,
      });
  }
  return { entries, skipped };
}

export function estimateCost(plan: DeployPlan): { onDemand: number | null; spot: number | null } {
  let onDemand = 0;
  let spot = 0;
  let anyOd = false;
  let anySpot = false;
  for (const e of plan.entries) {
    const p = (pricing.instances as Record<string, PriceInfo>)[e.instanceType];
    if (!p) continue;
    if (p.onDemandUsdPerHour != null) {
      onDemand += p.onDemandUsdPerHour;
      anyOd = true;
    }
    if (p.spotUsdPerHour != null) {
      spot += p.spotUsdPerHour;
      anySpot = true;
    }
  }
  return { onDemand: anyOd ? onDemand : null, spot: anySpot ? spot : null };
}

interface SizeEntry {
  repo?: string;
  files?: string[];
}

/** Direct HF URL for the verified GGUF file, or null when we don't have it. */
export function modelUrl(model: Model, quant: Quant): { url: string; file: string } | null {
  const entry = (sizes.models as Record<string, Record<string, unknown>>)[model.id];
  const repo = entry?.repo as string | undefined;
  const quantEntry = entry?.[quant] as SizeEntry | undefined;
  const file = quantEntry?.files?.[0];
  if (!repo || !file) return null;
  return { url: `https://huggingface.co/${repo}/resolve/main/${file}`, file };
}

export interface TemplateArgs {
  plan: DeployPlan;
  model: Model;
  quant: Quant;
  contextTokens: number;
  rigLabel: string;
}

/** GPU mode for a plan: true only when every node is a GPU instance class. */
export function gpuModeFor(plan: DeployPlan): "gpu" | "cpu" {
  return plan.entries.length > 0 &&
    plan.entries.every(
      (n) => n.instanceType.startsWith("g4dn") || n.instanceType.startsWith("g5") || n.instanceType.startsWith("g6e"),
    )
    ? "gpu"
    : "cpu";
}

/**
 * Build the template. Bash in userdata uses only unbraced `$var` shell
 * variables so CloudFormation `!Sub` (which substitutes `${...}`) can inject
 * the parameters without conflicts.
 */
export function buildTemplate(a: TemplateArgs): string {
  const mu = modelUrl(a.model, a.quant);
  const nodes = a.plan.entries;
  const date = new Date().toISOString().slice(0, 10);

  const nodeResources = nodes
    .map(
      (n, i) => `
  Node${i + 1}LaunchTemplate:
    Type: AWS::EC2::LaunchTemplate
    Properties:
      LaunchTemplateName: clusterbreak-${a.rigLabel}-node${i + 1}
      LaunchTemplateData:
        ImageId: "{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}"
        InstanceType: ${n.instanceType}
        KeyName: !Ref KeyName
        SecurityGroupIds: [!Ref NodeSecurityGroup]
        InstanceMarketOptions: !If [IsSpot, { MarketType: spot }, !Ref "AWS::NoValue"]
        MetadataOptions: { HttpEndpoint: enabled, HttpTokens: required, HttpPutResponseHopLimit: 1 }
        BlockDeviceMappings:
          - DeviceName: /dev/sda1
            Ebs: { VolumeSize: 60, VolumeType: gp3 }
        UserData:
          Fn::Base64: !Sub |
            #!/bin/bash
            set -euxo pipefail
            export DEBIAN_FRONTEND=noninteractive
            MODEL_URL="\${ModelUrl}"
            apt-get update -y
            apt-get install -y docker.io curl ca-certificates
            systemctl enable --now docker
            mkdir -p /opt/clusterbreak/models
            cd /opt/clusterbreak
            MODEL_FILE="$(basename "$MODEL_URL")"
            curl -L --retry 5 -C - -o "models/$MODEL_FILE" "$MODEL_URL"

            cat > /opt/clusterbreak/start-llama.sh <<'SCRIPT'
            #!/bin/bash
            set -eux
            if [ "$GPU_MODE" = "gpu" ]; then
              IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda
              GPU_FLAG="--gpus all"
            else
              IMAGE=ghcr.io/ggml-org/llama.cpp:server
              GPU_FLAG=""
            fi
            MODEL_FILE="$(basename "$MODEL_URL")"
            docker rm -f llama 2>/dev/null || true
            docker run -d --name llama --restart unless-stopped $GPU_FLAG -p 8080:8080 -v /opt/clusterbreak/models:/models "$IMAGE" -m "/models/$MODEL_FILE" --host 0.0.0.0 --port 8080 -c "$CTX"
            SCRIPT
            chmod +x /opt/clusterbreak/start-llama.sh

            cat > /etc/systemd/system/clusterbreak-llama.service <<'UNIT'
            [Unit]
            Description=Clusterbreak llama.cpp server
            After=docker.service network-online.target
            Wants=network-online.target docker.service

            [Service]
            Type=oneshot
            RemainAfterExit=yes
            Environment=GPU_MODE=\${GpuMode}
            Environment=CTX=\${ContextTokens}
            Environment=MODEL_URL=\${ModelUrl}
            ExecStartPre=/bin/bash -c 'if [ "$GPU_MODE" = "gpu" ]; then for i in $(seq 1 90); do nvidia-smi -L >/dev/null 2>&1 && exit 0; sleep 5; done; exit 1; fi'
            ExecStart=/bin/bash /opt/clusterbreak/start-llama.sh

            [Install]
            WantedBy=multi-user.target
            UNIT

            NEED_REBOOT=0
            if [ "\${GpuMode}" = "gpu" ]; then
              echo "blacklist nouveau" > /etc/modprobe.d/blacklist-nouveau.conf
              echo "options nouveau modeset=0" >> /etc/modprobe.d/blacklist-nouveau.conf
              update-initramfs -u
              apt-get install -y ubuntu-drivers-common
              if ! ubuntu-drivers install --gpgpu; then ubuntu-drivers install; fi
              curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
              curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' > /etc/apt/sources.list.d/nvidia-container-toolkit.list
              apt-get update -y
              apt-get install -y nvidia-container-toolkit
              nvidia-ctk runtime configure --runtime=docker
              systemctl restart docker
              if ! nvidia-smi -L >/dev/null 2>&1; then NEED_REBOOT=1; fi
            fi

            systemctl daemon-reload
            systemctl enable clusterbreak-llama.service
            if [ "$NEED_REBOOT" = "1" ]; then
              echo "nvidia driver installed but not yet active - rebooting; the systemd unit starts llama.cpp on boot"
              reboot
            else
              systemctl start clusterbreak-llama.service
            fi

  Node${i + 1}:
    Type: AWS::EC2::Instance
    Properties:
      LaunchTemplate:
        LaunchTemplateId: !Ref Node${i + 1}LaunchTemplate
        Version: !GetAtt Node${i + 1}LaunchTemplate.LatestVersionNumber
      SubnetId: !Ref PublicSubnet
      Tags:
        - { Key: Name, Value: clusterbreak-${a.rigLabel}-node${i + 1} }
        - { Key: clusterbreak:device, Value: "${n.device.name.replace(/"/g, "")}" }
`,
    )
    .join("");

  const outputs = nodes
    .map(
      (_, i) => `
  Node${i + 1}Endpoint:
    Description: llama.cpp endpoint for node ${i + 1} (ready a few minutes after the stack completes)
    Value: !Sub "http://\${Node${i + 1}.PublicIp}:8080"`,
    )
    .join("");

  return `AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Clusterbreak deploy kit — rig "${a.rigLabel}" (${nodes.length} node${nodes.length === 1 ? "" : "s"}),
  ${a.model.name} ${a.quant.toUpperCase()} @ ${a.contextTokens} ctx. Generated ${date}.
  Costs (on-demand) come from the AWS Pricing API snapshot of ${PRICING_FETCHED_AT} (${PRICING_REGION}).
  Bootstraps llama.cpp (Docker) per node; model pulled from Hugging Face in userdata.

Parameters:
  KeyName:
    Type: AWS::EC2::KeyPair::KeyName
    Description: Existing EC2 key pair for SSH access.
  SshCidr:
    Type: String
    Default: 0.0.0.0/0
    Description: CIDR allowed to reach SSH (22) and the llama.cpp port (8080). Restrict to your IP.
  Mode:
    Type: String
    Default: on-demand
    AllowedValues: [on-demand, spot]
    Description: spot can be reclaimed by AWS at any time (cheaper).
  GpuMode:
    Type: String
    Default: ${gpuModeFor(a.plan)}
    AllowedValues: [gpu, cpu]
    Description: gpu requires an approved G-instance quota in this account/region.
  ModelUrl:
    Type: String
    Default: "${mu?.url ?? ""}"
    Description: Direct .gguf download URL.${mu ? "" : " (No verified file for this model in the dataset — paste one.)"}
  ContextTokens:
    Type: Number
    Default: ${a.contextTokens}

Conditions:
  IsSpot: !Equals [!Ref Mode, spot]

Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.42.0.0/16
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags: [{ Key: Name, Value: !Sub "clusterbreak-${a.rigLabel}-vpc" }]
  Igw:
    Type: AWS::EC2::InternetGateway
  IgwAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties: { VpcId: !Ref Vpc, InternetGatewayId: !Ref Igw }
  PublicSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.42.1.0/24
      MapPublicIpOnLaunch: true
      AvailabilityZone: !Select [0, !GetAZs ""]
  RouteTable:
    Type: AWS::EC2::RouteTable
    Properties: { VpcId: !Ref Vpc }
  DefaultRoute:
    Type: AWS::EC2::Route
    DependsOn: IgwAttachment
    Properties:
      RouteTableId: !Ref RouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref Igw
  SubnetRouteAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PublicSubnet, RouteTableId: !Ref RouteTable }
  NodeSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: clusterbreak nodes - SSH + llama.cpp endpoint
      VpcId: !Ref Vpc
      SecurityGroupIngress:
        - { IpProtocol: tcp, FromPort: 22, ToPort: 22, CidrIp: !Ref SshCidr }
        - { IpProtocol: tcp, FromPort: 8080, ToPort: 8080, CidrIp: !Ref SshCidr }
        - { IpProtocol: -1, CidrIp: 10.42.0.0/16, Description: intra-VPC (node-to-node) }

${nodeResources}
Outputs:${outputs}

  QuickCheck:
    Description: Poll any endpoint until it answers (model download takes a few minutes)
    Value: !Sub "curl http://\${Node1.PublicIp}:8080/v1/models"
  Teardown:
    Description: Remove everything (stops all billing)
    Value: !Sub "aws cloudformation delete-stack --stack-name \${AWS::StackName} --region \${AWS::Region}"
`;
}
