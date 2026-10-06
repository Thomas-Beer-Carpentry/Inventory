import sys,json,os,subprocess
if sys.stdin.isatty():
 import termios
 settings=termios.tcgetattr(sys.stdin.fileno())
 settings[3]=settings[3]&~termios.ECHO
 termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,settings)
print('Ready for source credential on stdin (input is hidden).',flush=True)
credential=json.loads(sys.stdin.readline())
env=os.environ.copy()
env['GIT_CONFIG_COUNT']='1'
env['GIT_CONFIG_KEY_0']='http.extraHeader'
env['GIT_CONFIG_VALUE_0']='Authorization: Bearer '+credential['token']
env['GIT_TERMINAL_PROMPT']='0'
r=subprocess.run(['git','push',credential['remote_url'],'HEAD:refs/heads/'+credential['branch']],env=env,capture_output=True,text=True,timeout=45)
if r.returncode:
 print(r.stderr.replace(credential['token'],'[hidden]'),file=sys.stderr);sys.exit(r.returncode)
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
print(json.dumps({'commit_sha':sha,'pushed':True}))
