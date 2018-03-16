# Obtains the latest Kubeless release published
def run(event, context)
    require "net/https"
    require "uri"
    require "json"

    # Fetch release info
    uri = URI.parse("https://api.github.com/repos/bitnami/kubeless/releases")
    http = Net::HTTP.new(uri.host, uri.port)
    request = Net::HTTP::Get.new(uri.request_uri)
    http.use_ssl = true
    http.verify_mode = OpenSSL::SSL::VERIFY_PEER
    response = http.request(request)

    # Follow redirects if needed
    if response.code == "301"
      response = Net::HTTP.get_response(URI.parse(response.header['location']))
    end

    # Parse response
    output = JSON.parse(response.body)
    puts output
    # Create a Hash for output
    output_hash = { :version => output[0]['tag_name'] }

    return output_hash[:version]
end
