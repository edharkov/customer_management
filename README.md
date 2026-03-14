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

1. Build and push Docker images to Docker Hub (CI already publishes both images):

```bash
docker build -t obosecbot/customer-facing-web:latest -f services/web/Dockerfile services/web
docker build -t obosecbot/customer-management-api:latest -f services/management/Dockerfile services/management
docker push obosecbot/customer-facing-web:latest
docker push obosecbot/customer-management-api:latest
```

If your images are built locally only, use Minikube image build and switch to local-only pull policy first:

```bash
minikube image build -t obosecbot/customer-facing-web:latest -f services/web/Dockerfile services/web
minikube image build -t obosecbot/customer-management-api:latest -f services/management/Dockerfile services/management
```

and then set imagePullPolicy to `IfNotPresent` in the two deployment files.

2. Deploy Kubernetes resources with one command (namespace + dependencies in correct order):

```bash
./k8s/deploy.sh
```

If you see old pods still failing after an image fix, run:

```bash
./k8s/deploy.sh
kubectl -n customer-system delete pods -l app=customer-facing-web
kubectl -n customer-system delete pods -l app=customer-management
kubectl -n customer-system delete pods -l app=kafka
kubectl -n customer-system delete pods -l app=zookeeper
```

3. Optional: include Kafka-lag autoscaling by auto-installing KEDA:

```bash
./k8s/deploy.sh --with-keda
```

If you already have KEDA installed, `./k8s/deploy.sh` will detect it and apply the scaled object automatically.

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
