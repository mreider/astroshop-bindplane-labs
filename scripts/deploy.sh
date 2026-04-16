#!/usr/bin/env bash
set -euo pipefail

# Deploy astroshop + BindPlane agents to a GKE cluster.
# Usage: ./scripts/deploy.sh
#
# Requires:
#   - gcloud authenticated with access to the GKE cluster
#   - kubectl configured for the target cluster
#   - helm v4+
#   - bindplane CLI configured with API key
#
# Environment variables (set in .env or export before running):
#   BINDPLANE_SECRET_KEY  - BindPlane agent secret key
#   GKE_CLUSTER           - GKE cluster name (default: astroshop-bp)
#   GKE_REGION            - GKE region (default: us-central1)
#   GCP_PROJECT           - GCP project ID (default: dynatrace-dev-on-demand)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

GKE_CLUSTER="${GKE_CLUSTER:-astroshop-bp}"
GKE_REGION="${GKE_REGION:-us-central1}"
GCP_PROJECT="${GCP_PROJECT:-dynatrace-dev-on-demand}"

echo "==> Connecting to GKE cluster ${GKE_CLUSTER}..."
gcloud container clusters get-credentials "$GKE_CLUSTER" \
  --region "$GKE_REGION" \
  --project "$GCP_PROJECT"

echo "==> Applying BindPlane configurations..."
bindplane apply -f "$REPO_ROOT/bindplane/sources.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/gateway-destination.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/gateway-to-bindplane-destination.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/gateway-config.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/node-config.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/cluster-config.yaml"
bindplane apply -f "$REPO_ROOT/bindplane/fleets.yaml"

echo "==> Creating bindplane-agent namespace and secret..."
kubectl create namespace bindplane-agent --dry-run=client -o yaml | kubectl apply -f -
kubectl -n bindplane-agent create secret generic bindplane-agent-secret \
  --from-literal=secret-key="${BINDPLANE_SECRET_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Deploying BindPlane agents..."
kubectl apply \
  -f "$REPO_ROOT/bindplane/k8s-gateway-agent.yaml" \
  -f "$REPO_ROOT/bindplane/k8s-node-agent.yaml" \
  -f "$REPO_ROOT/bindplane/k8s-cluster-agent.yaml"

echo "==> Adding Helm repo..."
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts 2>/dev/null || true
helm repo update

echo "==> Deploying astroshop..."
helm upgrade --install astroshop open-telemetry/opentelemetry-demo \
  -f "$REPO_ROOT/astroshop-values.yaml" \
  --namespace astroshop --create-namespace

echo "==> Starting BindPlane rollouts..."
bindplane rollout start astroshop-gateway || true
bindplane rollout start astroshop-node || true
bindplane rollout start astroshop-cluster || true

echo "==> Waiting for rollouts to stabilize..."
sleep 30

echo "==> Checking status..."
kubectl get pods -n bindplane-agent
echo "---"
kubectl get pods -n astroshop
echo "---"
bindplane get agents

echo ""
echo "==> Deploy complete!"
EXTERNAL_IP=$(kubectl get svc -n astroshop frontend-proxy -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
echo "    Astroshop frontend: http://${EXTERNAL_IP}:8080/"
