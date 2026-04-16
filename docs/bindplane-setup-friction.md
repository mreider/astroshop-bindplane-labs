# BindPlane Setup Friction Notes

Notes from setting up BindPlane Cloud with a Kubernetes-based OpenTelemetry demo (astroshop) using the CLI and API. These are observations a PM might find useful — they're about where the product created confusion or extra work, not about the user being unfamiliar with the domain.

Each point below was verified against the official docs (docs.bindplane.com, including the full export at /llms-full.txt) and the observIQ GitHub repos as of April 2026.

## 1. Configuration YAML schema is undocumented for CLI/GitOps use

**Verified: the official docs contain zero examples of `bindplane apply` for any resource type.**

The `bindplane apply` command accepts YAML files, but there's no reference for the `Configuration` kind schema. The only examples that exist are in the test fixtures of the `observIQ/bindplane-op-action` GitHub repo — not linked from the docs.

Specific things I had to discover through trial and error:

- **`platform` is a label, not a spec field.** The UI presents platform as a first-class concept (kubernetes-gateway, kubernetes-daemonset, etc.). I tried `spec.platform` and got `invalid keys: platform`. Turns out it belongs under `metadata.labels.platform`. No error message hinted at this.
- **`measurementInterval`** only accepts `10s`, `1m`, `15m`, or `off`. Not documented anywhere — not in the docs, not in the full export. The error message is good once you hit it, but discoverability is zero.
- **Sources can be defined inline or as separate resources** — the test fixtures show inline definitions with `type` and `parameters` directly in the Configuration spec, while we ended up using separate `Source` resources referenced by name. Both work, but neither pattern is documented.

**Suggestion:** A schema reference, a `bindplane get configuration -o yaml --export` example in the docs, or a `bindplane scaffold configuration` command that generates a valid starting template would save significant time.

## 2. Source type names don't match display names — and there's no mapping

**Verified: the docs and source integration pages only show display names. CLI type names appear nowhere in the documentation.**

The UI and docs refer to sources as "Kubernetes Container Logs", "Kubernetes Kubelet", "Kubernetes Cluster", and "Kubernetes Events". The actual type names for CLI use are `k8s_container`, `k8s_kubelet`, `k8s_cluster`, and `k8s_events`. I first tried `container` and `kubelet`, which don't exist.

The individual source integration pages (e.g., docs.bindplane.com/integrations/sources/...) document parameters with UI screenshots but never mention the CLI type name. Even the `bindplane get source-types` command is documented in the CLI reference as existing, but with no example output and no explanation of how those names map to what you see in the UI.

**Suggestion:** Add the CLI type name to each source's documentation page. Or better — make the error message helpful: "unknown Source 'container' — did you mean 'k8s_container'?"

## 3. No Kubernetes manifest generation via CLI or API

**Verified: the `bindplane install agent` command only supports linux, macos, windows, and azure-container-apps-gateway. No Kubernetes platforms. The k8s install docs describe a UI-only workflow.**

For Kubernetes, you must use the UI to generate YAML manifests. This is a significant gap for GitOps/IaC workflows where everything should be CLI-driven and version-controlled.

I ended up hand-crafting the DaemonSet, Deployment, and Service manifests by finding an example in an observIQ GitHub repo (`high-availability-agent-gateway-opentelemetry-collector`). The key environment variables had to be pieced together from multiple sources:

- `OPAMP_ENDPOINT`, `OPAMP_SECRET_KEY`, `OPAMP_LABELS`, `OPAMP_AGENT_NAME` — documented in the opamp.md file in the collector repo
- `CONFIG_YAML_PATH`, `LOGGING_YAML_PATH` — found in the GitHub example manifests
- `MANAGER_YAML_PATH` — completely undocumented (see #4)

**Suggestion:** Either add `--platform kubernetes-gateway` to `bindplane install agent`, or provide a `bindplane generate manifest --configuration astroshop-gateway` command that outputs the full k8s YAML.

## 4. MANAGER_YAML_PATH is completely undocumented

**Verified: `MANAGER_YAML_PATH` does not appear in the official docs, the opamp.md documentation, or any documentation page we could find. The opamp.md documents a `--manager` CLI flag but not the environment variable.**

The agent container crashed immediately with:
```
Error while searching for management config: failed to write config file created from ENVs:
open ./manager.yaml: read-only file system
```

The agent tries to write `manager.yaml` to its working directory, which is read-only in a security-hardened container (`readOnlyRootFilesystem: true`). The fix is setting `MANAGER_YAML_PATH=/etc/otel/storage/manager.yaml` to point to a writable volume mount, but this env var is never mentioned in any documentation.

**Suggestion:** Document `MANAGER_YAML_PATH` alongside the other env vars in opamp.md. Include it in all Kubernetes manifest examples. Consider having the agent fall back to a temp directory if the working directory isn't writable.

## 5. Rollout errors are only visible in the UI — CLI shows no detail

**Verified: the rollout docs describe error diagnosis exclusively through the UI ("click the red error text to open a new tab that shows the collectors that are errored"). No CLI or API path for viewing the actual error message is documented.**

After rolling out configurations, the node and cluster agents failed because the BindPlane-generated collector config included metrics not supported by agent v1.80.1:

- `k8s_kubelet` source generated `k8s.pod.volume.usage` — not recognized by the agent
- `k8s_cluster` source generated `k8s.container.status.reason`, `k8s.service.endpoint.count`, etc.

`bindplane rollout status astroshop-node` showed `Error` with counts but no error message. I had to `kubectl logs` into the agent pod to find the actual deserialization error. The agent gracefully rolled back, which is good — but the diagnosis path was: notice "Error" in CLI → give up on CLI → kubectl logs → read collector stack trace.

**Suggestion:** Surface the agent-reported error message in `bindplane rollout status -o yaml` or `bindplane get agent <id>` output. Also consider validating source type compatibility against the agent version before starting a rollout.

## 6. Documentation site has broken links and inconsistent URL structure

Several docs pages returned 404s during setup:
- `docs.bindplane.com/how-to-guides/kubernetes/kubernetes-monitoring` → 404
- `docs.bindplane.com/how-to-guides/gitops` → 404 (the GitOps guide linked from other docs doesn't exist at the documented path)
- The actual URLs required an extra path segment like `/cloud-and-platform-integrations/` or `/infrastructure-and-operations/`

The 404 pages helpfully suggest the correct path and link to a sitemap, which is a nice touch. But links from blog posts, search results, and even other docs pages are stale.

## 7. Fleet auto-assignment via OPAMP_LABELS is not documented

**Verified: the fleet docs describe three assignment methods — UI, install-time UI, and `bindplane label agent` CLI. Setting `fleet=<name>` in OPAMP_LABELS for automatic assignment at pod startup is not documented anywhere.**

Once I figured out that adding `fleet=astroshop-gateway-fleet` to the `OPAMP_LABELS` env var automatically assigns agents to fleets on startup, the experience was smooth. The fleet YAML shows `selector.matchLabels.fleet: <name>` which hints at it, but the connection between that selector and the OPAMP_LABELS env var on the Kubernetes agent is never made explicit.

This is the most natural pattern for Kubernetes (set it in the manifest, forget it), but it's undocumented.

**Suggestion:** Add a "Kubernetes + Fleets" section showing the OPAMP_LABELS pattern for auto-assignment. This is arguably the primary fleet workflow for k8s users.

---

## What worked well

- **`bindplane apply` for sources, destinations, and configurations** — once I knew the YAML format, the GitOps workflow of applying files was clean and fast.
- **Rollout system** — the phased rollout with automatic rollback on failure is solid. Agents reverted gracefully when configs were incompatible.
- **Fleet concept** — simple, intuitive. Configurations flow through fleets to agents without per-agent management.
- **CLI is fast and well-organized** — `bindplane get agents`, `bindplane rollout status`, etc. are responsive and useful.
- **BindPlane Cloud OpAMP endpoint** — `wss://app.bindplane.com/v1/opamp` just worked. No server setup, no networking headaches.
- **Error messages for validation** — when things failed, the error messages were usually actionable (e.g., the measurementInterval error listed valid values). The gap is in discoverability *before* the error, not in the error itself.
