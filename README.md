# Kubeless Serverless Plugin

This plugin enables support for Kubeless within the [Serverless Framework](https://github.com/serverless).

## Give it a try
First you need to install serverless
```
$ npm install serverless -g
```

Clone the repo and check the example function
```
$ git clone https://github.com/bitnami/kubeless-serverless
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

Make sure you have k8s running in minikube and kubeless installed. Export K8S API endpoint.
```
$ export K8SAPISERVER=https://192.168.99.100:8443
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
