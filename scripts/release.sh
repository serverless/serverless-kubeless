#!/bin/bash
set -e

function get_version {
  echo $(jq -r .version ./package.json)
}

function check_tag {
  local tag=$1
  published_tags=`curl -s https://api.github.com/repos/$REPO_DOMAIN/$REPO_NAME/tags`
  already_published=`echo $published_tags | jq ".[] | select(.name == \"$tag\")"`
  echo $already_published
}

function release_tag {
  local tag=$1
  git fetch --tags
  local last_tag=`curl -s https://api.github.com/repos/$REPO_DOMAIN/$REPO_NAME/tags | jq --raw-output '.[0].name'`
  local release_notes=`git log $last_tag..HEAD --oneline`
  local parsed_release_notes=$(echo "$release_notes" | sed -n -e 'H;${x;s/\n/\\n   - /g;s/^\\n//;p;}')
  parsed_release_notes=`echo "$parsed_release_notes" | sed -e '${s/  \( - [^ ]* Merge pull request\)/\1/g;}'`
  release=`curl -H "Authorization: token $ACCESS_TOKEN" -s --data "{
    \"tag_name\": \"$tag\",
    \"target_commitish\": \"master\",
    \"name\": \"$REPO_NAME-$tag\",
    \"body\": \"Release $tag includes the following commits: \n$parsed_release_notes\",
    \"draft\": false,
    \"prerelease\": false
  }" https://api.github.com/repos/$REPO_DOMAIN/$REPO_NAME/releases`
  echo $release | jq ".id"
}

version=`get_version`

if [[ -z "$REPO_NAME" || -z "$REPO_DOMAIN" ]]; then
  echo "Github repository not specified" > /dev/stderr
  exit 1
fi

if [[ -n "$ACCESS_TOKEN" ]]; then
  echo "Unable to release: Github Token not specified" > /dev/stderr
  exit 1
fi

repo_check=`curl -s https://api.github.com/repos/$REPO_DOMAIN/$REPO_NAME`
if [[ $repo_check == *"Not Found"* ]]; then
  echo "Not found a Github repository for $REPO_DOMAIN/$REPO_NAME, it is not possible to publish it" > /dev/stderr
  exit 1
else
  tag=v$version
  already_published=`check_tag $tag`
  if [[ -z $already_published ]]; then
    echo "Releasing $tag in Github"
    release_id=`release_tag $tag`
    if [ "$release_id" == "null" ]; then
      echo "There was an error trying to release $tag" > /dev/stderr
      exit 1
    else
      echo "Released $tag with ID $release_id"
    fi
  else
    echo "Skipping Github release since $tag was already released"
  fi
fi
