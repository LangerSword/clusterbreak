# I built a simulator that breaks your AI rig before you buy it — then provisions it on AWS

**Clusterbreak is an interactive 3D simulator for local AI inference rigs, and a real AWS deploy kit for the cloud version of the same rig.** Build a machine from real hardware, run a model, break it on purpose — then take that rig to your own AWS account as a real `g5.xlarge` and talk to the model running on it.

Built solo for **First Commit** (WeMakeDevs × AWS Builder Center), **Ship It** track.

**Live:** [clusterbreak.langersword.in](https://clusterbreak.langersword.in)

**Code:** [Project Link](https://github.com/LangerSword/clusterbreak)

**[ IMAGE 1 — the landing page: click Insert image here and upload 1-landing-hero.png ]**

*The landing page — the hero instrument runs the real engine, not a mockup.*

## The question every local-AI build starts with

*Will my machine actually run this model?* The honest answer is scattered across benchmark repos, spreadsheets and vibes. Clusterbreak makes the physics visible: place devices on a 3D board, wire the nodes together, pick a model and a quantization, and run it.

**[ IMAGE 2 — the rig board: click Insert image here and upload 2-rig-board.png ]**

*Build the rig from real hardware cards — GPUs, Macs, laptops, a Steam Deck, CPU-only.*

The engine is dependency-free TypeScript and runs entirely in your browser. It models weights, KV cache, memory bandwidth, interconnect and thermals, and returns tokens/sec, time-to-first-token and the limiting resource — live.

### Where the numbers come from

- **Model sizes** — Hugging Face API, exact GGUF blob sizes, verified
- **Decode efficiency** — fitted from published measurements across **15 devices**
- **Context limits** — each model's own GGUF metadata (`gguf.context_length`)
- **Prices** — AWS Pricing API snapshot, timestamped in the UI

Where there is no measurement, the UI marks the value with a `~` and says *"no published measurement"* — a default parameter is never dressed up as data.

## Then you break it

Unplug a node mid-generation, cut the interconnect, cap VRAM. The postmortem does not just say *failed* — it traces the failure back to the exact constraint that produced it: memory, bandwidth, interconnect or compute. The report is a shareable link.

**[ IMAGE 3 — the break-it controls: click Insert image here and upload 3-break-it.png ]**

*Pick the failure — unplug the weakest node, cap VRAM, cut the interconnect — then read the causal chain that follows.*

## Taking the same rig to AWS

From the same board, Clusterbreak generates a **real CloudFormation template** for NVIDIA cards: one node per GPU, launched from the **Deep Learning base AMI** so CUDA is already installed, llama.cpp in Docker behind a per-stack API key, with the model pulled from Hugging Face in userdata.

**[ IMAGE 4 — the AWS panel: click Insert image here and upload 4-aws-panel.png ]**

*Connect your own account, then provision the rig you simulated.*

### The connect pattern

Clusterbreak **never sees or stores your access keys**. You install a small connect stack that creates a role trusting the Clusterbreak backend with an **ExternalId**, and the backend assumes it with **AWS STS**:

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::<your-account>:role/ClusterbreakDeployRole \
  --role-session-name clusterbreak \
  --external-id <the id baked into your stack>
```

The role is **read-wide, write-narrow**: it can describe stack state, but it can only create and delete `clusterbreak-*` stacks. It worked exactly as documented the first time — the highest compliment I can pay an auth flow.

Once connected, the app provisions the rig you simulated, lists your running rigs from the account itself, and lets you **prompt the model on your own instance** from the browser:

**[ IMAGE 5 — chat with the model on the rig: click Insert image here and upload 5-chat-with-rig.png ]**

*The model on a real `g5.xlarge`, answering about VRAM limits — and naming its own 24 GB of VRAM from the stack's facts.*

Tear it down when you are done, and a scheduled sweep kills anything you forget.

## What actually fought back

Every one of these was invisible to unit tests. They only appeared against real AWS, on a real GPU, with real latency — which is the argument for deploying while you build.

- **CloudFormation keeps a failed stack's name forever.** After a `CREATE_FAILED` the name can never be reused, and the API's only signal is `stack_exists` — which tells you nothing about whether the stack is live, failed or mid-delete. I built dead-stack detection, cleanup and automatic client retry around it.

- **Two system messages break a chat template.** The proxy prepends the model's real deployment facts; the UI seeded its own system prompt. Together: two system messages in a row, and Gemma's template rejects the request with *"Conversation roles must alternate user/assistant"*. The fix was normalizing the message list before it goes upstream.

- **The Deep Learning AMI already ships `containerd.io`.** Installing `docker.io` on top aborts the whole apt transaction, and under `set -e` the bootstrap died silently at 88 seconds. The DLAMI's 75 GB snapshot is also larger than the default 60 GB root volume, which fails at launch.

- **Lambda's default timeout is shorter than a CloudFormation create.** API Gateway closes the request at 30 seconds; a GPU stack takes longer. The proxy keeps a wait budget and the UI retries itself. Chat replies are capped for the same reason — for long generations the panel hands you an OpenAI-compatible endpoint to point a harness at.

- **My own teardown sweep deleted a freshly created rig.** A stale session record still owned the stack name, so the sweep saw an expired timer and killed the new instance. The sweep now never deletes a stack created after its timer was set.

- **The connect role needed permissions I did not expect.** The paginated stack listing needs `cloudformation:ListStacks` — a different action from `DescribeStacks` — and `ec2:DescribeKeyPairs` is not implied by anything else.

### A model that knows where it lives

Ask a quantized LLM what GPU it is on and it will confidently invent one — an 8B told me **A100** while running on an **A10G**. The chat proxy now prepends the model's real deployment facts (region, instance type, GPU, weights file, context window), read from the CloudFormation stack itself. Ask it now and it answers *"I am running on an NVIDIA A10G with 24 GB of VRAM."*

## The AWS open-source stack

The template is generated in TypeScript and validated as a **shipped artifact** with **cfn-lint** (AWS Labs):

```bash
aws cloudformation get-template --stack-name clusterbreak-demo --query TemplateBody > t.json
cfn-lint t.json
```

Linting the artifact rather than the source caught two bugs that would each have burned a ten-minute GPU deploy:

- `InstanceMarketOptions` is not a valid property of `AWS::EC2::Instance` — it belongs on a launch template.

- An unbraced `$VAR` meant CloudFormation never injected the model URL into userdata at all.

The backend is Python on **boto3** (STS, CloudFormation, EC2, DynamoDB), and the build and verify loop runs on **AWS CLI v2**.

**Services used:** S3, CloudFront, ACM, API Gateway, Lambda, DynamoDB, CloudFormation, IAM, STS, EC2 (`g5.xlarge`), EventBridge, Systems Manager, CloudWatch.

## Try it

1. **Simulate** — build a rig, break it, share the report: [clusterbreak.langersword.in/app.html](https://clusterbreak.langersword.in/app.html)

2. **Deploy** — generate the template from the same board, or connect your account and provision the rig for real.

3. **Verify** — the repo ships the graders: engine tests against measured anchors, a deployed-site grader with negative controls, and browser suites that drive provision → chat → teardown against live AWS.

**Live:** [clusterbreak.langersword.in](https://clusterbreak.langersword.in)

**Code:** [Project Link](https://github.com/LangerSword/clusterbreak)

If you want to argue with the numbers, the repo has the data pipeline that produced them and the graders that check the deployed site against it. That seemed more useful than a screenshot of a dashboard.
