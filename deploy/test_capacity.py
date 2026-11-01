from deploy.capacity import recommendation

def test_sustained_samples_only():
    assert recommendation([{'cpu_percent':99}])['status']=='insufficient_data'
    assert recommendation([{'cpu_percent':99}]*4+[{'cpu_percent':1}])['status']=='within_initial_thresholds'
    result=recommendation([{'cpu_percent':90,'ram_percent':85}]*5)
    assert result['status']=='review_capacity'
    assert result['approval_required']
