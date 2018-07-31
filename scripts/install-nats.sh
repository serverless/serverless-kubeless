#!/usr/bin/env bash

# Setup a NATS operator
kubectl apply -f https://raw.githubusercontent.com/nats-io/nats-operator/master/example/deployment-rbac.yaml

# Setup a basic NATS cluster
echo '
apiVersion: "nats.io/v1alpha2"
kind: "NatsCluster"
metadata:
  name: "nats"
spec:
  size: 3
  version: "1.1.0"
' | kubectl apply -f - -n nats-io

# Install the NATS controllers
kubectl create -f https://github.com/kubeless/kubeless/releases/download/$KUBELESS_VERSION/nats-$KUBELESS_VERSION.yaml

exit 0