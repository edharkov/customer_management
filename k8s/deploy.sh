#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="customer-system"
WITH_KEDA="${1:-}"

echo "Applying base Kubernetes resources..."
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
kubectl apply -f "$SCRIPT_DIR/mongo.yaml"
kubectl apply -f "$SCRIPT_DIR/kafka.yaml"
kubectl apply -f "$SCRIPT_DIR/management-service.yaml"
kubectl apply -f "$SCRIPT_DIR/web-service.yaml"
kubectl apply -f "$SCRIPT_DIR/autoscaling.yaml"

if kubectl get crd scaledobjects.keda.sh >/dev/null 2>&1; then
  echo "KEDA CRD found. Applying Kafka-lag scaled object."
  kubectl apply -f "$SCRIPT_DIR/management-keda-scaledobject.yaml"
elif [[ "$WITH_KEDA" == "--with-keda" ]]; then
  if ! command -v helm >/dev/null 2>&1; then
    echo "ERROR: helm is required to auto-install KEDA." >&2
    echo "Install helm or run without --with-keda to keep deployment without KEDA scaled object." >&2
    exit 1
  fi

  echo "KEDA CRD not found. Installing KEDA..."
  helm repo add kedacore https://kedacore.github.io/charts
  helm repo update
  helm upgrade --install keda kedacore/keda --namespace keda --create-namespace

  echo "Waiting for KEDA CRDs..."
  kubectl wait --for=condition=Established --timeout=120s crd/scaledobjects.keda.sh
  kubectl apply -f "$SCRIPT_DIR/management-keda-scaledobject.yaml"
else
  echo "KEDA CRD not found. Skipping Kafka-lag scaled object."
  echo "Run ./k8s/deploy.sh --with-keda to install KEDA automatically."
fi

echo "Waiting for deployments to be ready..."
kubectl -n "$NAMESPACE" rollout status deployment/customer-management --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/customer-facing-web --timeout=180s

echo "Deployment complete."
