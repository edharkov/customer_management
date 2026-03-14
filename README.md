# Customer Management Home Assignment

## What this solution includes

- Customer-Facing Web Service
  - `POST /buy` publishes `{username, userid, price, timestamp}` to Kafka.
  - `GET /getAllUserBuys` proxies to management service.
  - `GET /` serves a simple bonus frontend with:
    - Button `Buy`
    - Button `getAllUserBuys`
- Customer Management API
  - Kafka consumer reads purchases and writes to MongoDB.
  - `GET /purchases` returns saved purchases (optional `username` query).
- Infrastructure
  - MongoDB
  - Kafka + Zookeeper
  - Kubernetes manifests for all services
  - Autoscaling:
    - web + management HPAs with resource metrics
    - Kafka-lag scale-out option through KEDA ScaledObject
- Required assignment UUID label
  - `assignment-uuid: e271b052-9200-4502-b491-62f1649c07` is applied to all Kubernetes resources.

## Run on Kubernetes (Minikube)

1. Build the Docker images in Minikube's registry:

```bash
minikube image build -t customer-facing-web:latest -f services/web/Dockerfile services/web
minikube image build -t customer-management-api:latest -f services/management/Dockerfile services/management
```

2. Apply common resources:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/kafka.yaml
kubectl apply -f k8s/management-service.yaml
kubectl apply -f k8s/web-service.yaml
kubectl apply -f k8s/autoscaling.yaml
```

3. Optional Kafka-lag autoscaling (recommended for this use case):

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
kubectl apply -f k8s/management-keda-scaledobject.yaml
```

4. Access the UI:

```bash
kubectl -n customer-system get svc customer-facing-web
```

or

```bash
minikube service customer-facing-web -n customer-system
```

## API usage (quick test)

Buy:

```bash
curl -X POST http://<HOST>:<PORT>/buy \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","userid":"u-100","price":9.99}'
```

Get all buys:

```bash
curl "http://<HOST>:<PORT>/getAllUserBuys?username=alice"
```

Get all entries (no filter):

```bash
curl "http://<HOST>:<PORT>/getAllUserBuys"
```

## Notes / implementation remarks

- The web service is intentionally stateless and only emits events to Kafka.
- Management service owns MongoDB persistence and Kafka consumption.
- This keeps write-path and read-path concerns separated.
- Kafka topic is auto-created with one partition in this sample setup.

## Suggested cleanup

```bash
kubectl delete namespace customer-system
helm uninstall keda -n keda
```
