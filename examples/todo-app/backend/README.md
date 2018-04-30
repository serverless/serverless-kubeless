# Serverless backend

Do the following to deploy and use the backend:

1. Install kubeless following the instruction from the main [README.md](../../../README.md)
2. Install an Ingress Controller. If you don't have it yet and you are working with minikube you can enable the addon executing:
```
minikube addons enable ingress
```
3. Deploy a MongoDB service. It will be used to store the state of our application:
```console
$ curl -sL https://raw.githubusercontent.com/bitnami/bitnami-docker-mongodb/3.4.7-r0/kubernetes.yml | kubectl create -f -
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
Serverless: Function delete successfully deployed
Serverless: Function read-all successfully deployed
Serverless: Function update successfully deployed
Serverless: Function create successfully deployed
Serverless: Function read-one successfully deployed
```

# Running the Backend in GKE

In case your cluster is running on GCE you need to perform some additional steps. First you need to follow the [guide for deploying an Ingress Controller](https://github.com/kubernetes/ingress-nginx/blob/master/docs/deploy/index.md). Make sure you execute the "Mandatory commands", the ones for "Install without RBAC roles" and also "GCE - GKE" (using RBAC). If you successfully follow the guide you should be able to see the Ingress Controller running in the `ingress-nginx` namespace:

```
$ kubectl get pods -n ingress-nginx
NAME                                        READY     STATUS    RESTARTS   AGE
default-http-backend-66b447d9cf-zs2zn       1/1       Running   0          13m
nginx-ingress-controller-6fb4c56b69-cpd5b   1/1       Running   3          12m
```

After a couple of minutes you will see that the Ingress rule has an `address` associated:

```
$ kubectl get ingress
NAME      HOSTS                   ADDRESS          PORTS     AGE
todos     35.196.179.155.xip.io   35.229.122.182   80        7m
```

Note that the `HOST` is not correct since the IP that the Ingress provided us is different. To modify it execute `kubectl edit ingress todos`. That will open an editor in which you can change the key `host: 35.196.179.155.xip.io` for `host: 35.229.122.182.xip.io` or simply remove the key and the value to make it compatible with any host. Once you do that you should be able to access the functions:

```
$ kubectl get ingress
NAME      HOSTS                   ADDRESS          PORTS     AGE
todos     35.229.122.182.xip.io   35.229.122.182   80        7m
$ curl  35.229.122.182.xip.io/read-all
[]
```

This host is the one that should be used as `API_URL` in the frontend.
