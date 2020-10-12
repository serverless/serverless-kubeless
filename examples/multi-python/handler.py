def foo(event, context):
    print(event['data'])
    return 'foo'


def bar(event, context):
    print(event['data'])
    return 'bar'
