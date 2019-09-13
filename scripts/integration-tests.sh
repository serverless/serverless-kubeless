#!/bin/bash
set -e

install_kubectl() {
    curl -LO https://storage.googleapis.com/kubernetes-release/release/v1.7.8/bin/linux/amd64/kubectl
    chmod +x ./kubectl
    sudo mv ./kubectl /usr/local/bin/kubectl
}

install_minikube() {
    `dirname $0`/install-minikube.sh
}

install_kubecfg() {
    curl -LO https://github.com/ksonnet/kubecfg/releases/download/v0.5.0/kubecfg-linux-amd64
    chmod +x ./kubecfg-linux-amd64
    sudo mv ./kubecfg-linux-amd64 /usr/local/bin/kubecfg
    chmod +x  /usr/local/bin/kubecfg
    if [ ! -d "ksonnet-lib" ]; then
      git clone --depth=1 https://github.com/ksonnet/ksonnet-lib.git ksonnet-lib
    fi
    export KUBECFG_JPATH=$PWD/ksonnet-lib
}

install_kubeless() {
    kubectl create ns kubeless
    kubectl create -f https://github.com/kubeless/kubeless/releases/download/$KUBELESS_VERSION/kubeless-$KUBELESS_VERSION.yaml
    kubectl create -f https://github.com/kubeless/kafka-trigger/releases/download/$KUBELESS_KAFKA_VERSION/kafka-zookeeper-$KUBELESS_KAFKA_VERSION.yaml
    curl -LO https://github.com/kubeless/kubeless/releases/download/$KUBELESS_VERSION/kubeless_linux-amd64.zip
    unzip kubeless_linux-amd64.zip
    sudo mv ./bundles/kubeless_linux-amd64/kubeless /usr/local/bin/kubeless
    # Wait for Kafka pod to be running
    until kubectl get all --all-namespaces | sed -n 's/po\/kafka-0//p' | grep Running; do kubectl -n kubeless describe pod kafka-0; sleep 10; done
}

install_minio() {
  kubectl create -f `dirname $0`/../test/minio.yml
  until kubectl get -n kubeless deployment minio -o jsonpath="{.status.readyReplicas}" | grep 1; do sleep 5; done
}

# Install dependencies
echo "Installing kubectl"
install_kubectl
echo "Installing Minikube"
install_minikube
echo "Installing kubecfg"
install_kubecfg
echo "Installing Kubeless"
install_kubeless
echo "Installing Minio"
install_minio
kubectl get all --all-namespaces

# Run tests
set +e
npm run examples
result=$?
set -e

# Clean up
minikube delete

exit $result
