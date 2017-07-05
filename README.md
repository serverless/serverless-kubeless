# Kubeless Serverless Plugin

This plugin brings [Kubeless](https://github.com/kubeless/kubeless) support within the [Serverless Framework](https://github.com/serverless).

Kubeless is a Kubernetes-native Serverless solution.

## Pre requisites

Make sure you have a kubernetes endpoint running (e.g minikube) and kubeless installed: 
 
```
$ minikube version
$ kubectl version
$ brew install kubeless/tap/kubeless
$ kubectl create ns kubeless
$ kubectl create -f $(curl -s https://api.github.com/repos/kubeless/kubeless/releases/latest | jq -r ".assets[] | select(.name | test(\"yaml\")) | .browser_download_url")
```

Then install serverless
```
$ npm install serverless -g
```

## Try out the example

Clone this repo and check the example function
```
$ git clone https://github.com/serverless/serverless-kubeless
$ cd examples
$ cat serverless.yml
service: hello

provider:
  name: google
  runtime: python2.7

plugins:
  - kubeless-serverless

functions:
  hello:
    handler: handler.hello
```

Download dependencies
```
$ npm install
```

Export the Kubernetes API endpoint.
```
$ export KUBE_API_URL=https://192.168.99.100:8443
```

Deploy function.
```
$ serverless deploy
Serverless: Packaging service...
Serverless: Deploying function: hello...
```

The function will be deployed to k8s via kubeless.
```
$ kubectl get function
NAME      KIND
hello     Function.v1.k8s.io

$ kubectl get po
NAME                     READY     STATUS    RESTARTS   AGE
hello-1815473417-1ttt7   1/1       Running   0          1m
```

Remove the function.
```
$ serverless remove
```
