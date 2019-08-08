# Simple Hello World function with custom kubernetes Ingress class & annotations

In this example we will deploy a function that with custom annotations in its ingress metadata. Check the `serverless.yml` file to see the specific syntax.

## Pre requisites

We will need to have an Ingress controller deployed.

## Background info

An Ingress controller will typically have a class name, for example:

```
kubernetes.io/ingress.class: nginx
# or perhaps
kubernetes.io/ingress.class: azure/application-gateway
```

An Ingress controller will also have annotations to control their behavior, like these:

```
nginx.ingress.kubernetes.io/example-rule-1: true
# or another ingress annotation might look like this
appgw.ingress.kubernetes.io/rule-example-2: false
```

An Ingress class isn't nessesarily the same as it's name in annotations. 
(seen above with `azure/application-gateway` and `appgw`)

## Deployment

```console
$ npm install
$ serverless deploy
Serverless: Packaging service...
Serverless: Excluding development dependencies...
Serverless: Function hello successfully deployed
```

Make sure you have `kubectl` installed and that it can access your cluster (See documentation for your cloud provider if using a managed k8s service.)

We can now get the Ingress information for our new function. (If this doesn't work, as a workout use `edit` instead of `describe`)

```
$ kubectl describe Ingress hello
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  annotations:
    ingressName.ingress.kubernetes.io/rewrite-target: /
    ingressName.ingress.kubernetes.io/example-rule-1: "true"
    ingressName.ingress.kubernetes.io/example-rule-2: "false"
    kubernetes.io/ingress.class: foo/bar-ingress-class
  creationTimestamp: "2019-08-07T11:09:20Z"
  generation: 2
  name: hello
  namespace: default
  resourceVersion: "191340"
  selfLink: /apis/extensions/v1beta1/namespaces/default/ingresses/hello
  uid: aaaaa000-a000-a000-a000-a000a000a000
spec:
  rules:
  - host: example.com
    http:
      paths:
      - backend:
          serviceName: hello
          servicePort: 8080
        path: /hello/
status:
  loadBalancer: {}
```