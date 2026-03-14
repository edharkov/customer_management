#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="customer-system"
WITH_KEDA="${1:-}"

KEDA_VERSION="${KEDA_VERSION:-2.16.1}"
KEDA_RELEASE_URL="https://github.com/kedacore/keda/releases/download/v${KEDA_VERSION}/keda-${KEDA_VERSION}.yaml"

install_keda_crds() {
  echo "Installing KEDA from upstream release manifest (v${KEDA_VERSION})..."
  kubectl apply -f "$KEDA_RELEASE_URL"
  echo "Waiting for KEDA CRDs..."
  kubectl wait --for=condition=Established --timeout=180s crd/scaledobjects.keda.sh
}

install_keda_with_helm() {
  if ! command -v helm >/dev/null 2>&1; then
    echo "helm not found. Falling back to release manifest installation."
    install_keda_crds
    return
  fi

  echo "KEDA CRD not found. Installing KEDA via Helm..."
  helm repo add kedacore https://kedacore.github.io/charts >/dev/null
  helm repo update >/dev/null
  helm upgrade --install keda kedacore/keda --namespace keda --create-namespace
  echo "Waiting for KEDA CRDs..."
  kubectl wait --for=condition=Established --timeout=180s crd/scaledobjects.keda.sh
}

echo "Applying base Kubernetes resources..."
kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
kubectl apply -f "$SCRIPT_DIR/mongo.yaml"
kubectl apply -f "$SCRIPT_DIR/kafka.yaml"
kubectl apply -f "$SCRIPT_DIR/management-service.yaml"
kubectl apply -f "$SCRIPT_DIR/web-service.yaml"
kubectl apply -f "$SCRIPT_DIR/autoscaling.yaml"
kubectl rollout restart deployment/customer-management deployment/customer-facing-web deployment/kafka deployment/zookeeper -n "$NAMESPACE"

if kubectl get crd scaledobjects.keda.sh >/dev/null 2>&1; then
  echo "KEDA CRD found. Applying Kafka-lag scaled object."
  kubectl apply -f "$SCRIPT_DIR/management-keda-scaledobject.yaml"
elif [[ "$WITH_KEDA" == "--with-keda" || "$WITH_KEDA" == "--with-keda-crd" || "$WITH_KEDA" == "--install-keda-crd" ]]; then
  echo "KEDA CRD not found. Installing KEDA resources..."
  if [[ "$WITH_KEDA" == "--with-keda" ]]; then
    install_keda_with_helm
  else
    install_keda_crds
  fi
  kubectl apply -f "$SCRIPT_DIR/management-keda-scaledobject.yaml"
else
  echo "KEDA CRD not found. Skipping Kafka-lag scaled object."
  echo "Run ./k8s/deploy.sh --with-keda or ./k8s/deploy.sh --with-keda-crd to install KEDA."
fi

echo "Waiting for deployments to be ready..."
kubectl -n "$NAMESPACE" rollout status deployment/customer-management --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/customer-facing-web --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/kafka --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/zookeeper --timeout=180s

echo "Deployment complete."
