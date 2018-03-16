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
    kubectl create -f https://github.com/kubeless/kubeless/releases/download/v$KUBELESS_VERSION/kubeless-v$KUBELESS_VERSION.yaml
    curl -sLO https://raw.githubusercontent.com/kubeless/kubeless/v$KUBELESS_VERSION/kafka-zookeeper.jsonnet
    mv kafka-zookeeper.jsonnet ./test
    kubecfg -V controller_image=bitnami/kafka-trigger-controller:v$KUBELESS_VERSION update ./test/kafka-novols.jsonnet
    curl -sL https://raw.githubusercontent.com/kubeless/kubeless/master/manifests/ingress/ingress-controller-http-only.yaml | kubectl create -f -
    curl -LO https://github.com/kubeless/kubeless/releases/download/v$KUBELESS_VERSION/kubeless_linux-amd64.zip
    unzip kubeless_linux-amd64.zip
    sudo mv ./bundles/kubeless_linux-amd64/kubeless /usr/local/bin/kubeless
    # Wait for Kafka pod to be running
    until kubectl get all --all-namespaces | sed -n 's/po\/kafka//p' | grep Running; do kubectl -n kubeless describe pod kafka-0; sleep 10; done
}

# Install dependencies
install_kubectl
install_minikube
install_kubecfg
install_kubeless
kubectl get all --all-namespaces

# Run tests
set +e
npm run examples
result=$?
set -e

# Clean up
minikube delete

exit $result