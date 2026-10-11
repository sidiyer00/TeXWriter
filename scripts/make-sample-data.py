"""Generates the sample project's portfolio extracts (dev tool; output is committed)."""
import csv, math, os, random
random.seed(42)
D = os.path.join(os.path.dirname(__file__), '..', 'resources', 'sample', 'data')
grades = [(1,412,0,0.0003,0.06),(2,688,1,0.0008,0.09),(3,1204,3,0.0021,0.16),(4,1577,11,0.0048,0.21),
          (5,1311,16,0.0105,0.18),(6,842,25,0.024,0.14),(7,455,35,0.051,0.11),(8,168,22,0.118,0.05)]
def w(name, header, rows):
    with open(os.path.join(D, name), 'w', newline='') as f:
        c = csv.writer(f); c.writerow(header); c.writerows(rows)
w('grades_2025.csv', ['grade','obligors','defaults','avg_pd','ead_share'], grades)
sectors = {'industrials':1842,'consumer':1206,'energy':512,'real_estate':988,'technology':1131,'utilities':978}
tot = sum(sectors.values())
# obligor split per grade: energy skews riskier
rows = []
alloc = {s:[0]*8 for s in sectors}
for gi,(g,n,dd,pd,_) in enumerate(grades):
    wts = {s: v/tot * (1 + (0.12*(gi-3.5) if s=='energy' else 0)) for s,v in sectors.items()}
    z = sum(wts.values()); left = n
    for k,(s,v) in enumerate(wts.items()):
        c = n - sum(alloc[x][gi] for x in list(wts)[:k]) if k==len(wts)-1 else round(n*v/z)
        alloc[s][gi] = c
# defaults per grade per sector: energy gets flat-ish share
dal = {s:[0]*8 for s in sectors}
for gi,(g,n,dd,pd,_) in enumerate(grades):
    wts = {s: alloc[s][gi] * (1.0 if s!='energy' else 1.0) for s in sectors}
    # energy: move defaults from risky grades to safe grades
    if gi <= 3: wts['energy'] *= 3.3
    if gi >= 6: wts['energy'] *= 0.6
    z = sum(wts.values())
    rem = dd
    order = sorted(sectors, key=lambda s: -wts[s])
    raw = {s: dd*wts[s]/z for s in sectors}
    for s in sectors: dal[s][gi] = int(math.floor(raw[s]))
    short = dd - sum(dal[s][gi] for s in sectors)
    for s in sorted(sectors, key=lambda s: -(raw[s]-math.floor(raw[s])))[:short]: dal[s][gi]+=1
seg=[]
for s in sectors:
    for gi,(g,*_) in enumerate(grades): seg.append([s,g,alloc[s][gi],dal[s][gi]])
w('segment_grades_2025.csv',['segment','grade','obligors','defaults'],seg)
# score bands per sector
dev_mix = {'industrials':0.271,'consumer':0.189,'energy':0.064,'real_estate':0.152,'technology':0.160,'utilities':0.164}
cur_mix = {s: sectors[s]/tot for s in sectors}
base = [0.18,0.24,0.27,0.20,0.11]
shift = {'industrials':0.04,'consumer':0.035,'energy':0.43,'real_estate':0.06,'technology':0.05,'utilities':0.03}
b=[]
for s in sectors:
    sh = shift[s]
    cur = [base[0]*(1-sh), base[1]*(1-sh*0.6), base[2], base[3]*(1+sh*0.7), base[4]*(1+sh*1.9)]
    zc = sum(cur); cur=[x/zc for x in cur]
    for k in range(5): b.append([s,f'B{k+1}',sectors[s],round(dev_mix[s],4),round(cur_mix[s],4),round(base[k],4),round(cur[k],4)])
w('sector_score_bands.csv',['sector','band','obligors','dev_weight','cur_weight','dev_share','cur_share'],b)
ch=[]
for name,dev,cur in [('leverage_ratio',[0.22,0.31,0.27,0.14,0.06],[0.135,0.26,0.29,0.198,0.117]),('interest_cover',[0.12,0.25,0.33,0.30],[0.14,0.27,0.32,0.27])]:
    for k,(d1,c1) in enumerate(zip(dev,cur)): ch.append([name,f'bin_{k+1}',d1,c1])
w('characteristic_bins.csv',['characteristic','bin','dev_share','cur_share'],ch)
w('data_quality.csv',['field','label','populated','total','threshold'],[
 ['ebitda','EBITDA field',6398,6657,0.98],['revenue','Revenue field',6640,6657,0.98],['total_debt','Total debt field',6601,6657,0.98],
 ['interest_expense','Interest expense field',6569,6657,0.98],['industry_code','Industry code',6657,6657,0.995],['rating_date','Rating date',6650,6657,0.995]])
w('backtest_by_year.csv',['year','obligors','defaults','avg_pd'],[[2021,6011,71,0.0129],[2022,6204,77,0.0131],[2023,6389,92,0.0133],[2024,6512,96,0.0132],[2025,6657,113,0.0132]])
w('monitoring.csv',['metric','numerator','denominator'],[['override_rate',759,6657],['rating_coverage',6420,6657]])
