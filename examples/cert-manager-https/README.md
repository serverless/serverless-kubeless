# Cert manager https example

In this example we will deploy a function that will have ssl automatically setup by cert manager.

## Prerequisites 

* Cert Manager install with [cluster issuer shim](https://cert-manager.readthedocs.io/en/latest/reference/ingress-shim.html) setup.
* Optional [external dns](https://github.com/kubernetes-incubator/external-dns) setup to automate dns configuration.

## Deploy

```console
$ npm install
$ serverless deploy
```