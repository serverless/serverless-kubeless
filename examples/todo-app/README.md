# Todos

<p align="center">
  <img src="todos-1.gif?raw=true" alt="Todos demo"/>
</p>

This is the source code of the Serverless `Todos` service.

You'll find two directories here. Deploy them in the following order:

1. The [backend](backend) directory contains the whole Serverless service and it's corresponding function code.
2. The [frontend](frontend) directory contains the frontend you can connect to your backend to use the Todos service through your web browser.

# Known issue

When deploying this applicaiton with the default ingress controller the web browser may reject the self-signed certificate used. To be able to use the application go to `https://API_URL` (where API_URL is the URL of your cluster) and add the certificate to the white list. 

# Source

This is a modified version of Philipp Muens Todo example from his serverless [book](https://github.com/pmuens/serverless-book/blob/master/06-serverless-by-example/02-a-serverless-todo-application.md). Modified to run on [Kubeless](https://github.com/kubeless/kubeless)
