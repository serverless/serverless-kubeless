# Kubeless Serverless Plugin

This plugin brings [Kubeless](https://github.com/kubeless/kubeless) support within the [Serverless Framework](https://github.com/serverless).

Kubeless is a Kubernetes-native Serverless solution.

## Pre requisites

Make sure you have a kubernetes endpoint running and kubeless installed. You can find the installation intructions [here](https://github.com/kubeless/kubeless#installation).

Once you have Kubeless running in your cluster you can install serverless
```bash
$ npm install serverless -g
```

## Try out the example

Clone this repo and check the example function
```bash
$ git clone https://github.com/serverless/serverless-kubeless
$ cd examples/get-python
$ cat serverless.yml
service: hello

provider:
  name: kubeless
  runtime: python2.7

plugins:
  - serverless-kubeless

functions:
  hello:
    description: 'Hello function'
    handler: handler.hello
```

Download dependencies
```bash
$ npm install
```

Deploy function.
```bash
$ serverless deploy
Serverless: Packaging service...
Serverless: Excluding development dependencies...
Serverless: Deploying function hello...
Serverless: Function hello successfully deployed
```

The function will be deployed to k8s via kubeless.
```bash
$ kubectl get function
NAME      KIND
hello     Function.v1.k8s.io

$ kubectl get po
NAME                     READY     STATUS    RESTARTS   AGE
hello-1815473417-1ttt7   1/1       Running   0          1m
```

Now you will be able to call the function:
```bash
$ serverless invoke -f hello -l
Serverless: Calling function: hello...
--------------------------------------------------------------------
hello world
```

You can also check the logs for the function:
```bash
$ serverless logs -f hello
172.17.0.1 - - [12/Jul/2017:09:47:18 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/118
172.17.0.1 - - [12/Jul/2017:09:47:21 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/93
172.17.0.1 - - [12/Jul/2017:09:47:24 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/108
172.17.0.1 - - [12/Jul/2017:09:47:25 +0000] "GET / HTTP/1.1" 200 11 "" "" 0/316
```

Or you can obtain the function information:
```bash
$ serverless info
Service Information "hello"
Cluster IP:  10.0.0.51
Type:  ClusterIP
Ports:
  Name:  http-function-port
  Protocol:  TCP
  Port:  8080
  Target Port:  8080
Function Info
Description: Hello function
Handler:  handler.hello
Runtime:  python2.7
Trigger: HTTP
Dependencies:
```

You can access the function through its HTTP interface as well using `kubectl proxy` and accessing:
```bash
$ curl http://127.0.0.1:8001/api/v1/namespaces/default/services/hello/proxy/
hello world
```

If you have a change in your function and you want to redeploy it you can run:
```bash
$ serverless deploy function -f hello
Serverless: Redeploying hello...
Serverless: Function hello successfully deployed
```

Finally you can remove the function.
```bash
$ serverless remove
Serverless: Removing function: hello...
Serverless: Function hello successfully deleted
```

