# Simple Hello World function

This function schedules a function to be executed every minute.

You can set the period between executions following the cron format. 

```console
$ npm install
$ serverless deploy
$ sls logs -f clock -t
Loading /kubeless/handler.js
...
::ffff:172.17.0.1 - - [15/Sep/2017:14:29:03 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "Go-http-client/1.1"
14:29
::ffff:172.17.0.8 - - [15/Sep/2017:14:29:09 +0000] "GET / HTTP/1.1" 200 - "-" "Wget"
::ffff:172.17.0.1 - - [15/Sep/2017:14:29:33 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "Go-http-client/1.1"
::ffff:172.17.0.1 - - [15/Sep/2017:14:30:03 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "Go-http-client/1.1"
14:30
::ffff:172.17.0.8 - - [15/Sep/2017:14:30:09 +0000] "GET / HTTP/1.1" 200 - "-" "Wget"
$ serverless remove
```
