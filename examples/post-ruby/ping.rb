def run(event, context)
  if event[:data] == 'ping'
    return 'pong'
  else
    return 'not ping pong!'
  end
end
