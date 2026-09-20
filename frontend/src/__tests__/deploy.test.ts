import { describe, expect, it } from "vitest";
import { DEVICES, MODELS } from "../sim";
import { buildTemplate, estimateCost, instanceForDevice, modelUrl, planDeploy } from "../deploy/cfn";

function device(id: string) {
  const d = DEVICES.find((x) => x.id === id);
  if (!d) throw new Error(`device ${id} missing`);
  return d;
}

function model(id: string) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`model ${id} missing`);
  return m;
}

describe("deploy kit", () => {
  it("maps NVIDIA devices to EC2 classes and rejects non-EC2 hardware", () => {
    expect(instanceForDevice(device("rtx3090_24gb"))?.instanceType).toBe("g5.xlarge");
    expect(instanceForDevice(device("rtx5090_32gb"))?.instanceType).toBe("g6e.xlarge");
    expect(instanceForDevice(device("rtx3050_laptop_4gb"))?.instanceType).toBe("g4dn.xlarge");
    expect(instanceForDevice(device("apple_m2_ultra_192gb"))).toBeNull();
    const plan = planDeploy([device("rtx3090_24gb"), device("apple_m2_ultra_192gb")]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("costs come from the vendored pricing snapshot (2× g5.xlarge)", () => {
    const plan = planDeploy([device("rtx3090_24gb"), device("rtx3090_24gb")]);
    const cost = estimateCost(plan);
    expect(cost.onDemand).toBeCloseTo(2 * 1.208, 2);
    expect(cost.spot).toBeCloseTo(2 * 0.4689, 2);
  });

  it("builds the verified HF URL for a known model", () => {
    const mu = modelUrl(model("llama3.1_8b"), "q4_k_m");
    expect(mu?.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/);
    expect(mu?.file.endsWith(".gguf")).toBe(true);
  });

  it("template contains the full rig: VPC, subnet, SG, one node per device, outputs", () => {
    const plan = planDeploy([device("rtx3090_24gb"), device("rtx3090_24gb")]);
    const yaml = buildTemplate({
      plan,
      model: model("llama3.3_70b"),
      quant: "q4_k_m",
      contextTokens: 4096,
      rigLabel: "dual-3090",
    });
    expect(yaml).toContain('AWSTemplateFormatVersion: "2010-09-09"');
    expect(yaml).toContain("AWS::EC2::VPC");
    expect(yaml).toContain("AWS::EC2::Subnet");
    expect(yaml).toContain("AWS::EC2::SecurityGroup");
    expect(yaml).toContain("Node1:");
    expect(yaml).toContain("Node2:");
    expect(yaml).not.toContain("Node3:");
    expect(yaml).toContain("InstanceType: g5.xlarge");
    // spot must live in a LaunchTemplate — AWS::EC2::Instance has no InstanceMarketOptions
    expect(yaml).toContain("AWS::EC2::LaunchTemplate");
    const ltIdx = yaml.indexOf("AWS::EC2::LaunchTemplate");
    const imoIdx = yaml.indexOf("InstanceMarketOptions");
    const nodeIdx = yaml.indexOf("\n  Node1:\n");
    expect(ltIdx).toBeGreaterThan(-1);
    expect(imoIdx).toBeGreaterThan(ltIdx);
    expect(nodeIdx).toBeGreaterThan(imoIdx);
    expect(yaml).toContain("llama.cpp:server-cuda");
    expect(yaml).toContain('docker run -d --name llama');
    expect(yaml).toContain('Environment=CTX=${ContextTokens}');
    expect(yaml).toContain("Default: 4096");
    expect(yaml).toContain('MODEL_URL="${ModelUrl}"');
    // GPU nodes use the Deep Learning base AMI (driver preinstalled): no
    // userdata driver install, no nouveau blacklist, no mid-bootstrap restart
    expect(yaml).toContain("base-oss-nvidia-driver-gpu-ubuntu-24.04");
    expect(yaml).not.toContain("blacklist nouveau");
    expect(yaml).not.toContain("ubuntu-drivers install");
    expect(yaml).toContain("IsGpu: !Equals [!Ref GpuMode, gpu]");
    // the unit must survive slow starts and show failures on the EC2 console
    expect(yaml).toContain("Restart=on-failure");
    expect(yaml).toContain("StandardOutput=journal+console");
    expect(yaml).toContain("clusterbreak-llama.service");
    expect(yaml).toContain("nvidia-smi -L");
    expect(yaml).toContain("Node2Endpoint");
    expect(yaml).toContain("delete-stack");
    expect(yaml).toMatch(/resolve\/main\/.+\.gguf/);
    // ${Node1.PublicIp} must survive as a CloudFormation substitution (not be pre-eaten)
    expect(yaml).toContain("http://${Node1.PublicIp}:8080");
  });

  it("uses the CPU image and no gpu branch default when nothing maps to a GPU", () => {
    const plan = planDeploy([]);
    const yaml = buildTemplate({
      plan,
      model: model("llama3.1_8b"),
      quant: "q4_k_m",
      contextTokens: 1024,
      rigLabel: "empty",
    });
    expect(yaml).toContain("Default: cpu");
  });

  it("gates the endpoint with a per-stack bearer key and documents harness use", () => {
    const plan = planDeploy([device("rtx3090_24gb")]);
    const yaml = buildTemplate({
      plan,
      model: model("llama3.1_8b"),
      quant: "q4_k_m",
      contextTokens: 4096,
      rigLabel: "chat-test",
    });
    // the key parameter must be NoEcho (never echoed back in stack events)
    expect(yaml).toContain("ApiKey:");
    expect(yaml).toMatch(/ApiKey:\n(?:.*\n)*?\s+NoEcho: true/);
    // llama.cpp must actually require it, and the unit must pass it through
    expect(yaml).toContain('API_FLAG="--api-key $API_KEY"');
    expect(yaml).toContain("Environment=API_KEY=${ApiKey}");
    // 8080 is open on purpose (key is the gate); SSH stays pinned to SshCidr
    expect(yaml).toContain("FromPort: 8080, ToPort: 8080, CidrIp: 0.0.0.0/0");
    expect(yaml).toContain("FromPort: 22, ToPort: 22, CidrIp: !Ref SshCidr");
    // harness output so the endpoint can be used from any OpenAI-compatible client
    expect(yaml).toContain("Harness:");
    expect(yaml).toContain("OPENAI_BASE_URL=http://${Node1.PublicIp}:8080/v1");
  });
});
