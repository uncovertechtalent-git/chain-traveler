#!/usr/bin/env bash
# Keyless AWS access for a GitHub Actions job: exchanges the job's OIDC token for a short role session.
# No long-lived key exists anywhere; the role's trust policy (uncovertechtalent-git/site-infra) names this
# repository and either the main branch or the production environment, and nothing else.
#
# Source it in the step that needs AWS, then call the function; the session lives in that step's shell only:
#   . scripts/ci/aws-session.sh
#   aws_session "$AWS_ROLE_ARN" chain-traveler-deploy 900
#
# Needs the OIDC request variables that GitHub sets for jobs with `permissions: id-token: write`.

aws_session() {
  local role_arn="${1:?role arn}" session_name="${2:?session name}" seconds="${3:-900}" token creds
  echo "::add-mask::$role_arn"
  token=$(curl -fsS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL:?}&audience=sts.amazonaws.com" | jq -r .value) || return 1
  echo "::add-mask::$token"
  creds=$(aws sts assume-role-with-web-identity --role-arn "$role_arn" \
    --role-session-name "${session_name}-${GITHUB_RUN_ID:?}" --web-identity-token "$token" \
    --duration-seconds "$seconds" --query Credentials --output json) || return 1
  AWS_ACCESS_KEY_ID=$(jq -r .AccessKeyId <<<"$creds")
  AWS_SECRET_ACCESS_KEY=$(jq -r .SecretAccessKey <<<"$creds")
  AWS_SESSION_TOKEN=$(jq -r .SessionToken <<<"$creds")
  echo "::add-mask::$AWS_ACCESS_KEY_ID"
  echo "::add-mask::$AWS_SECRET_ACCESS_KEY"
  echo "::add-mask::$AWS_SESSION_TOKEN"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  echo "::add-mask::$(aws sts get-caller-identity --query Account --output text)"
}
