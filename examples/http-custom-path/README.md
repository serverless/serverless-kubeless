# Simple Hello World function available in a certain HTTP path

In this example we will deploy a function that will be available under the path `/hello`. Check the `serverless.yml` file to see the specific syntax.

## Pre requisites

We will need to have an Ingress controller deployed in order to be able to deploy your function in a specific path. If you don't have it yet you can deploy one executing:

```
curl -sL https://raw.githubusercontent.com/kubeless/kubeless/master/manifests/ingress/ingress-controller-http-only.yaml | kubectl create -f -  
```

## Deployment

```console
$ npm install
$ serverless deploy -v
Serverless: Packaging service...
Serverless: Deploying function hello...
Serverless: Deployed Ingress rule to map /hello
Serverless: Waiting for function hello to be fully deployed. Pods status: {"waiting":{"reason":"PodInitializing"}}
Serverless: Function hello successfully deployed
```

As we can see in the logs an Ingress Rule has been deployed to run our function at `/hello`. If no host is specified, by default it will use `API_URL.nip.io` being `API_URL` the URL/IP of the Kubernetes IP. We can know the specific URL in which the function will be listening executing `serverless info`:
```console
$ serverless info
Service Information "hello"
Cluster IP:  10.0.0.161
Type:  NodePort
Ports:
  Protocol:  TCP
  Port:  8080
  Target Port:  8080
  Node Port:  31444
Function Info
URL:  192.168.99.100.nip.io/hello
Handler:  handler.hello
Runtime:  python2.7
Trigger:  HTTP
Dependencies:
```

Note that if you don't specify a hostname in your `serverless.yaml` it will be configured to use a DNS service like [`nip.io`](http://nip.io) setting the property `defaultDNSResolution` in the provider section. You can also change the default DNS resolutor to a different service like [`xip.io`](http//xip.io).

Depending on the Ingress configuration the URL may be redirected to use the HTTPS protocol. You can call your function with a browser or executing:
```console
$ curl 192.168.99.100.nip.io/hello
hello world
```

## GKE and Firewall limitation

For some providers like Google you may need to add a firewall rule for allowing the traffic for the port 80 and 443 so you can connect to the IP the ingress controller provides.

Note that even though GCE has its own ingress controller available by default it is not suitable for our use case since the annotation `ingress.kubernetes.io/rewrite-target` is not interpreted by that controller. You will need to deploy an Nginx controller like the one explained in the [pre requisites section](#pre-requisites).
