# Serverless backend

Do the following to deploy and use the backend:

1. Install kubeless following the instruction from the main [README.md](../../../README.md)
2. Install an Ingress Controller in case you still don't have one:
```
$ curl -sL https://raw.githubusercontent.com/kubeless/kubeless/master/manifests/ingress/ingress-controller-http-only.yaml | kubectl create -f - 
```
3. Deploy a MongoDB service. It will be used to store the state of our application:
```console
$ curl -sL https://raw.githubusercontent.com/bitnami/bitnami-docker-mongodb/master/kubernetes.yml | kubectl create -f -
```
4. Run `npm install` to install the used npm packages
5. Run `serverless deploy` to deploy the `todo` service in our kubernetes cluster
```console
$ serverless deploy
Serverless: Packaging service...
Serverless: Deploying function delete...
Serverless: Deploying function update...
Serverless: Deploying function read-one...
Serverless: Deploying function create...
Serverless: Deploying function read-all...
Serverless: Function delete succesfully deployed
Serverless: Function read-all succesfully deployed
Serverless: Function update succesfully deployed
Serverless: Function create succesfully deployed
Serverless: Function read-one succesfully deployed
```