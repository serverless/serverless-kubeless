# Chaining Example

This example concatenates three different functions (capitalize, pad and reverse) and return its result.

```console
$ npm install
$ serverless deploy
$ serverless invoke -f chained_seq -l --data 'hello world!'
Serverless: Calling function: chained_seq...
Serverless: Calling function: capitalize...
Serverless: Calling function: pad...
Serverless: Calling function: reverse...
--------------------------------------------------------------------
****!dlrow olleH****
$ serverless remove
```
