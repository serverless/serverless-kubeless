def foo(request):
    print str(request.json)
    return 'foo'

def bar(request):
    print str(request.json)
    return'bar'
