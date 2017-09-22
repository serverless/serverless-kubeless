def run(request)
  if request.body.read == 'ping'
    return 'pong'
  else
    return 'not ping pong!'
  end
end
