import json, urllib.request
P="http://127.0.0.1:8545"; WTV="0xe1ab85a8b4d5d5b6af0bbd0203eb322df33d0464"
TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
def rpc(method, params):
    req=urllib.request.Request(P, data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),
                               headers={"content-type":"application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read()).get("result")
latest=int(rpc("eth_blockNumber",[]),16)
print("latest", latest)
# scan back in 9000-block chunks for WTVARA transfers
froms={}; tos={}; total=0; start=latest
b=latest
while b > latest-300000 and b>0:
    lo=max(0,b-9000)
    logs=rpc("eth_getLogs",[{"address":WTV,"fromBlock":hex(lo),"toBlock":hex(b),"topics":[TRANSFER]}]) or []
    for l in logs:
        f="0x"+l["topics"][1][-40:]; t="0x"+l["topics"][2][-40:]
        froms[f]=froms.get(f,0)+1; tos[t]=tos.get(t,0)+1; total+=1
    if total and len(logs): pass
    b=lo-1
    if total>2000: break
print("total transfers seen:", total)
def code(a):
    c=rpc("eth_getCode",[a,"latest"]) or "0x"; return len(c)>4
print("\nFROM (minters/distributors):")
for a,n in sorted(froms.items(),key=lambda x:-x[1])[:6]: print(f"  {a} x{n} contract={code(a)}")
print("\nTO recipients that are CONTRACTS (router/mirror candidates):")
cands=[a for a in tos if code(a) and a!="0x0000000000000000000000000000000000000000"]
for a in sorted(cands,key=lambda x:-tos[x])[:10]:
    # check wrappedVara()
    try:
        r=rpc("eth_call",[{"to":a,"data":"0x"+"a0a8e460"}, "latest"])  # wrappedVara() selector guess
    except Exception as e: r=None
    print(f"  {a} x{tos[a]}")
