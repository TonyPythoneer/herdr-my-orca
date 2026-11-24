# print PIDs descended from the test app PID given as $1
python3 - "$1" <<'P'
import subprocess,sys
root=int(sys.argv[1])
rows=[l.split(None,2) for l in subprocess.check_output(["ps","-axo","pid=,ppid=,command="],text=True).splitlines()]
kids={}
for p,pp,c in rows: kids.setdefault(int(pp),[]).append((int(p),c))
def walk(p,d=0):
    for k,c in kids.get(p,[]):
        print("  "*d+f"{k} {c[:200]}"); walk(k,d+1)
print(root); walk(root)
P
