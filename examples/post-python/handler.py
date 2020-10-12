def echo(event, context):
    print(event)
    return event['data']
