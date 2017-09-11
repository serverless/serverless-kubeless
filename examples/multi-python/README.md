# Multiple Functions in a Single Service

A service can have multiple functions which can come from the same file.

```
functions:
  foo:
    handler: handler.foo
  bar:
    handler: handler.bar
```


```console
$ npm install
$ serverless deploy
Serverless: Packaging service...
Serverless: Function foo succesfully deployed
Serverless: Function bar succesfully deployed
```

You can invoke each function

```console
$ serverless invoke -f foo -d '{"foo":"bar"}' -l
Serverless: Calling function: foo...
--------------------------------------------------------------------
foo
$ serverless invoke -f bar -d '{"bar":"foo"}' -l
Serverless: Calling function: bar...
--------------------------------------------------------------------
bar
```

You can access the logs of each function

```console
$ serverless logs -f bar
Bottle v0.12.13 server starting up (using CherryPyServer())...
Listening on http://0.0.0.0:8080/
Hit Ctrl-C to quit.
172.17.0.1 - - [18/Jul/2017:13:36:26 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/178
{u'toto': u'tata'}
172.17.0.1 - - [18/Jul/2017:13:36:26 +0000] "POST / HTTP/1.1" 200 3 "" "" 0/336

$ serverless logs -f foo
Bottle v0.12.13 server starting up (using CherryPyServer())...
Listening on http://0.0.0.0:8080/
Hit Ctrl-C to quit.
172.17.0.1 - - [18/Jul/2017:13:36:17 +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/87
{u'toto': u'tata'}
172.17.0.1 - - [18/Jul/2017:13:36:18 +0000] "POST / HTTP/1.1" 200 3 "" "" 0/352
```

Finally, remove the service and associated functions

```console
$ serverless remove
```
