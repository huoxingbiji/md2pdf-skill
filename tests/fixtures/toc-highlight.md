# 目录与代码高亮验证

> 用于验证生成目录的内部跳转、中文锚点、重复标题去重和代码语法高亮。

## 数据准备

```python
def normalize_records(records):
    return [record for record in records if record.get("enabled")]
```

## 规则执行

```sql
SELECT asset_id, owner_name
FROM security_assets
WHERE status = 'active'
ORDER BY asset_id;
```

### 检查结果

第一处同名标题。

### 检查结果

第二处同名标题，用于验证目标锚点自动追加序号。

附录
----

Setext 标题用于验证不同 Markdown 标题写法。
