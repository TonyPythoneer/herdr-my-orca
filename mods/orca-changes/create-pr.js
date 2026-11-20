const QUERY = `query($owner:String!,$repo:String!,$head:String!){repository(owner:$owner,name:$repo,followRenames:false){id nameWithOwner isArchived isFork defaultBranchRef{name target{oid}} ref(qualifiedName:$head){name prefix target{oid}}}}`;
const CREATE = `mutation($repo:ID!,$base:String!,$head:String!,$title:String!,$body:String!,$draft:Boolean!){createPullRequest(input:{repositoryId:$repo,baseRefName:$base,headRefName:$head,title:$title,body:$body,draft:$draft}){pullRequest{number url}}}`;

function githubRemote(url) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  if (!m || m[2] === '.' || m[2] === '..') throw new Error('The upstream must have one standard GitHub.com URL without credentials.');
  return { owner: m[1], repo: m[2] };
}

async function checked(run, args, label) {
  const r = await run(args);
  if (r.code !== 0) throw new Error(`${label}: ${(r.stderr || r.stdout || 'command failed').trim()}`);
  return r.stdout;
}

function onlyValue(value, label) {
  const values = value.split('\0');
  if (values.length !== 2 || values[1] !== '' || !values[0] || /[\r\n]/.test(values[0])) throw new Error(`Expected one ${label}.`);
  return values[0];
}

async function graphql(gh, args) {
  const result = await checked(gh, ['api', 'graphql', '--hostname', 'github.com', ...args], 'GitHub request failed');
  let data;
  try { data = JSON.parse(result); } catch { throw new Error('Invalid response from GitHub.'); }
  if (data.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '));
  return data.data;
}

export async function prepareCreatePr(git, gh) {
  const ref = (await checked(git, ['symbolic-ref', '--quiet', 'HEAD'], 'Cannot read current branch')).trim();
  if (!ref.startsWith('refs/heads/')) throw new Error('A local branch is required.');
  const branch = ref.slice('refs/heads/'.length);
  const oid = (await checked(git, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Cannot read HEAD')).trim();
  const remote = onlyValue(await checked(git, ['config', '--null', '--get-all', `branch.${branch}.remote`], 'Missing upstream remote'), 'upstream remote');
  const merge = onlyValue(await checked(git, ['config', '--null', '--get-all', `branch.${branch}.merge`], 'Missing upstream branch'), 'upstream branch');
  if (remote === '.' || remote.startsWith('-') || !merge.startsWith('refs/heads/')) throw new Error('A GitHub upstream branch is required.');
  const urls = (await checked(git, ['remote', 'get-url', '--all', remote], 'Cannot read upstream URL')).trim().split('\n');
  if (urls.length !== 1) throw new Error('Multiple upstream URLs are not supported.');
  const { owner, repo } = githubRemote(urls[0]);
  const data = await graphql(gh, ['-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-f', `head=${merge}`]);
  const r = data?.repository, head = merge.slice('refs/heads/'.length), base = r?.defaultBranchRef?.name;
  if (!r?.id || r.isArchived || r.isFork || r.nameWithOwner?.toLowerCase() !== `${owner}/${repo}`.toLowerCase() || !base || !r.defaultBranchRef.target?.oid || r.ref?.prefix !== 'refs/heads/' || r.ref?.name !== head || r.ref?.target?.oid !== oid) throw new Error('Push the current commit to its GitHub upstream before creating a PR.');
  if (head === base) throw new Error('The current branch is the default branch.');
  return { branch, oid, remote, merge, url: urls[0], repoId: r.id, name: r.nameWithOwner, head, base, baseOid: r.defaultBranchRef.target.oid };
}

export async function createPr(snapshot, git, gh, current, title, body, draft) {
  if (!current()) throw new Error('Workspace changed; PR creation cancelled.');
  const now = await prepareCreatePr(git, gh);
  if (!current() || JSON.stringify(now) !== JSON.stringify(snapshot)) throw new Error('Branch, repository or default branch changed; open the dialog again.');
  if (!title.trim()) throw new Error('A title is required.');
  // GitHub creates a PR for a branch, not an immutable commit; the branch can advance after verification.
  let result;
  try {
    result = await graphql(gh, ['-f', `query=${CREATE}`, '-f', `repo=${snapshot.repoId}`, '-f', `base=${snapshot.base}`, '-f', `head=${snapshot.head}`, '-f', `title=${title}`, '-f', `body=${body}`, '-F', `draft=${Boolean(draft)}`]);
  } catch (e) { throw new Error(`PR creation failed or its result is unknown. Check GitHub before retrying. ${e.message}`); }
  const pr = result?.createPullRequest?.pullRequest;
  if (!pr?.number || !/^https:\/\/github\.com\//.test(pr.url ?? '')) throw new Error('PR result unknown. Check GitHub before retrying.');
  return pr;
}
