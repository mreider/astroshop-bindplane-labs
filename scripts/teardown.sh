#!/usr/bin/env bash
set -euo pipefail

# Tear down astroshop + BindPlane agents from the GKE cluster.
# Usage: ./scripts/teardown.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

echo "==> Uninstalling astroshop Helm release..."
helm uninstall astroshop --namespace astroshop 2>/dev/null || echo "astroshop not installed"

echo "==> Removing BindPlane agents..."
kubectl delete -f "$REPO_ROOT/bindplane/k8s-gateway-agent.yaml" \
  -f "$REPO_ROOT/bindplane/k8s-node-agent.yaml" \
  -f "$REPO_ROOT/bindplane/k8s-cluster-agent.yaml" 2>/dev/null || true

echo "==> Cleaning up namespaces..."
kubectl delete namespace astroshop --ignore-not-found
kubectl delete namespace bindplane-agent --ignore-not-found

echo "==> Teardown complete."
