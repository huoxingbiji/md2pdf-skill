# MD2PDF v1.2 回归测试

> 中文、公式、流程图、代码、表格、本地图片和分页组合样例。

## Markdown 安全修复

这里应该显示为粗体：**重要业务含义： **转换只修复临时内容，不修改本文件。

## 数学公式

行内公式：当计划量为 $P_i$、实际量为 $A_i$ 时计算达成情况。

$$
DAR = \frac{\sum_i \min(A_i, P_i)}{\sum_i P_i} \times 100\%
$$

## Mermaid 整页矢量图

```mermaid full-page
flowchart LR
  A[业务输入] --> B[规则校验]
  B --> C[计划冻结]
  C --> D[上线事件]
  D --> E[入库事件]
  E --> F[SKU 汇总]
  F --> G[产品线汇总]
  G --> H[BI 看板]
  B --> I[异常记录]
  I --> J[人工确认]
  J --> C
  classDef main fill:#1b4965,color:#fff,stroke:#0d1b2a;
  classDef branch fill:#f59e0b,color:#111827,stroke:#b45309;
  class A,B,C,D,E,F,G,H main;
  class I,J branch;
```

整页图之后的内容应从新页面开始。

## 代码保护

```sql
SELECT '$not_math$' AS formula_like_text,
       '**not bold**' AS markdown_like_text;
```

```python
def calculate_achievement(plan: float, actual: float) -> float:
    """Return the capped production achievement ratio."""
    if plan <= 0:
        raise ValueError("plan must be positive")
    return min(actual, plan) / plan
```

以下代码块未声明语言，用于验证谨慎的自动识别：

```
const records = orders
  .filter((order) => order.status === 'completed')
  .map(({ id, amount }) => ({ id, amount: Number(amount) }));

console.log(JSON.stringify(records, null, 2));
```

## 跨页表格

| 序号 | 指标 | 说明 |
|---:|---|---|
| 1 | 日计划量 | 冻结计划中的当日数量 |
| 2 | 日实际量 | 生产日窗口内的实际上线量 |
| 3 | 有效完成量 | 实际量与计划量取较小值 |
| 4 | 欠量 | 计划量减实际量，小于零时取零 |
| 5 | 超量 | 实际量减计划量，小于零时取零 |
| 6 | 周计划量 | 一周内各生产日计划量之和 |
| 7 | 周实际量 | 一周内各生产日实际量之和 |
| 8 | 月计划量 | 自然月内冻结计划量之和 |
| 9 | 月入库量 | 自然月内有效入库数量 |
| 10 | 入库产值 | 入库数量乘以销售价格 |
| 11 | 数量覆盖率 | 有价格数量除以总数量 |
| 12 | 价值覆盖率 | 已覆盖价值除以总价值 |
| 13 | 数据完整性 | 必填字段和维度关联检查 |
| 14 | 发布批次 | BI 只读取最后成功发布批次 |
| 15 | 历史快照 | 已关闭周期保持冻结状态 |
| 16 | 迟到数据 | 进入受控重算和审计流程 |
| 17 | 产品线 | SKU 指标重新汇总得到 |
| 18 | 父系列 | SKU 指标重新汇总得到 |
| 19 | 子系列 | SKU 指标重新汇总得到 |
| 20 | 重点机型 | 只改变参与统计的 SKU 范围 |
| 21 | 币种 | 输出前统一口径 |
| 22 | 税口径 | 输出前统一口径 |
| 23 | 成本单位 | 与价值输出保持一致 |
| 24 | 更新时间 | 展示数据批次时间 |

## 本地图片

![本地资源](sample.svg)

附录验证
--------

Setext 标题也应获得稳定锚点，并出现在可点击目录中。
