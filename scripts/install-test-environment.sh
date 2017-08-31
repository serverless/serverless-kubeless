#!/bin/bash
set -e

install_kubectl() {
    curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
    chmod +x ./kubectl
    mv ./kubectl /usr/local/bin/kubectl
}

install_minikube() {
    `dirname $0`/install-minikube.sh
}

install_kubecfg() {
    curl -LO https://github.com/ksonnet/kubecfg/releases/download/v0.5.0/kubecfg-linux-amd64
    chmod +x ./kubecfg-linux-amd64
    sudo mv ./kubecfg-linux-amd64 /usr/local/bin/kubecfg
    chmod +x  /usr/local/bin/kubecfg
    git clone --depth=1 https://github.com/ksonnet/ksonnet-lib.git
    export KUBECFG_JPATH=$PWD/ksonnet-lib
}

install_kubeles() {
    kubectl create ns kubeless
    curl -sLO https://raw.githubusercontent.com/kubeless/kubeless/v$KUBELESS_VERSION/kubeless.jsonnet
    mv kubeless.jsonnet ./test
    local release_yaml=`curl -L https://github.com/kubeless/kubeless/releases/download/v$KUBELESS_VERSION/kubeless-v$KUBELESS_VERSION.yaml`
    local controller_image=`expr match "$release_yaml" '.*\(bitnami\/kubeless-controller@sha256:[a-z..0-9]*\).*'`
    kubecfg -V controller_image=$controller_image update ./test/kubeless-novols.jsonnet
    curl -sL https://raw.githubusercontent.com/kubeless/kubeless/0.0.20/manifests/ingress/ingress-controller.yaml | kubectl create -f -
    curl -LO https://github.com/kubeless/kubeless/releases/download/v$KUBELESS_VERSION/kubeless_linux-amd64.zip
    unzip kubeless_linux-amd64.zip
    sudo mv ./bundles/kubeless_linux-amd64/kubeless /usr/local/bin/kubeless
    # Wait for Kafka pod to be running
    until kubectl get all --all-namespaces | sed -n 's/po\/kafka//p' | grep Running; do kubectl -n kubeless describe pod kafka-0; sleep 10; done
}

install_npm_deps() {
    npm install -g serverless
    npm install
}

install_kubectl
install_minikube
install_kubecfg
install_kubeles
install_npm_deps

kubectl get all --all-namespaces
