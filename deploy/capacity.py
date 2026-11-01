"""Pure recommendation logic. No provider API or automatic resize action."""
def recommendation(samples, minimum_samples=5, cpu=75, ram=80, disk=80, latency_ms=1000):
    if len(samples)<minimum_samples:
        return {'status':'insufficient_data','approval_required':True,'reasons':[]}
    window=samples[-minimum_samples:]
    thresholds={'cpu_percent':cpu,'ram_percent':ram,'disk_percent':disk,'latency_ms':latency_ms}
    reasons=[name for name,limit in thresholds.items() if all(s.get(name,0)>limit for s in window)]
    return {'status':'review_capacity' if reasons else 'within_initial_thresholds','approval_required':True,'reasons':reasons}
