# Simple Event Triggered function

In this example we will deploy a function that will be triggered whenever a message is published under a certain topic.

The topic in which the function will be listening is defined in the `events` section of the `serverless.yml`

```console
$ npm install
$ serverless deploy
$ kubeless topic publish --topic hello_topic --data 'hello world!' # push a message into the queue
$ serverless logs -f hello
hello world!
```
