# Kubeless Serverless Plugin

This plugin brings [Kubeless](https://github.com/kubeless/kubeless) support within the [Serverless Framework](https://github.com/serverless).

Kubeless is a Kubernetes-native Serverless solution.

## Pre requisites

Make sure you have a kubernetes endpoint running (for the moment only minikube is supported) and kubeless installed:

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
  - serverless-kubeless

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
Serverless: Function hello succesfully deployed
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

Now you will be able to call the function:
```
$ serverless invoke -f hello -l
Serverless: Calling function: hello...
--------------------------------------------------------------------
hello world
```

You can also check the logs for the function:
```
$ serverless logs -f hello
172.17.0.1 - - [12/Jul/2017:09:47:18 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/118
172.17.0.1 - - [12/Jul/2017:09:47:21 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/93
172.17.0.1 - - [12/Jul/2017:09:47:24 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/108
172.17.0.1 - - [12/Jul/2017:09:47:25 +0000] "GET / HTTP/1.1" 200 11 "" "" 0/316
```

Or you can obtain the function information:
```
$ serverless info
Service Information "hello"
Cluster IP:  10.0.0.51
Type:  NodePort
Ports:
  Protocol:  TCP
  Port:  8080
  Target Port:  8080
  Node Port:  30018
Function Info
Handler:  handler.hello
Runtime:  python2.7
Topic:
Dependencies:
```

Since we are using minikube to run kubernetes we can call directly the function through HTTP and the Node Port in which the function is running:
```
$ curl  http://192.168.99.100:30018
hello world
```

Finally you can remove the function.
```
$ serverless remove
Serverless: Removing function: hello...
Serverless: Function hello succesfully deleted
```
