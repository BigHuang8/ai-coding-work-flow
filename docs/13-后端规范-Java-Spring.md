# 后端规范：Java + Spring Boot + Spring Cloud

本文件是后端代码的**唯一规范来源**。项目可以按自身情况覆盖，但覆盖时必须写明差异与理由，并保持全文中文。

配套文档：[10-技术栈适配](10-技术栈适配.md)（校验命令怎么接）、[15-数据库设计与建表规范](15-数据库设计与建表规范.md)（表怎么建）、[12-影响面与回归防护](12-影响面与回归防护.md)（改公共代码前做什么）。

## 一、技术基线

| 项 | 约定 |
| --- | --- |
| JDK | 17（LTS），统一语言级别，不写低版本兼容代码 |
| 构建 | Maven 多模块；版本统一在父 POM / BOM 管理，子模块**不写版本号** |
| 框架 | Spring Boot 3.x + Spring Cloud 2023.x，版本以 BOM 为准 |
| 持久层 | MyBatis-Plus + MySQL 8.x（字符集 `utf8mb4`） |
| 缓存 / 消息 | Redis 7 / RocketMQ（或项目既有的同类中间件） |
| 接口文档 | OpenAPI（springdoc），随代码生成，不手写维护 |

原则：**框架升级单独开分支**，不与业务改动混在一个提交里；升级必须跑通全量测试并记录到 `CHANGELOG.md`。

## 二、模块与分层

### 2.1 依赖方向只能单向

```text
Controller  →  Service  →  Mapper  →  DB
                   ↘  Client(Feign)  →  其它服务
```

- 禁止反向依赖（Service 不得引用 Controller）。
- 禁止跨模块直接访问别人的 `Mapper` / `Entity`，模块间只通过服务接口或 Feign 交互。
- 禁止在 Controller 里写业务判断；禁止在 Service 里拼装 HTTP 响应。

### 2.2 包结构：按业务域分包，域内再分层

```text
com.example.order
├── controller      接口层：参数校验、鉴权、组装响应
├── service         业务层：规则编排、事务边界
│   └── impl
├── mapper          数据访问
├── entity          数据库实体（与表一一对应）
├── dto             入参对象
├── vo              出参对象
├── converter       entity ↔ dto / vo 转换
└── enums
```

反例：`com.example.controller` 下堆所有模块的 Controller，按技术层分包在大项目里会迅速失控。

### 2.3 各层职责与被禁止的事

| 层 | 可以做 | 不可以做 |
| --- | --- | --- |
| Controller | 参数校验、鉴权注解、调用一个 Service、返回 `Result<T>` | 业务分支、事务、直接调 Mapper |
| Service | 业务规则、事务、组装 VO、调用其它服务 | 写 SQL、拼装响应体 |
| Mapper | SQL 与结果映射 | 业务判断、调用其它 Mapper |
| Entity | 表结构映射、字段默认值 | 直接作为接口出参（会泄露内部字段） |
| DTO / VO | 接口输入输出契约 | 复用 Entity 当 DTO |

## 三、命名约定

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| Controller | `<域>Controller` | `OrderController` |
| Service | `<域>Service` 接口 + `<域>ServiceImpl` 实现（小项目可只留实现类） | `OrderService` / `OrderServiceImpl` |
| 入参对象 | `<动作>Req` | `OrderCreateReq`、`OrderQueryReq` |
| 出参对象 | `<域>VO` | `OrderVO`、`OrderDetailVO` |
| 实体 | 表名转驼峰 | `OrderItem` |
| 转换器 | `<域>Converter` | `OrderConverter` |
| 枚举 | `<域><语义>Enum`，取值大写下划线 | `OrderStatusEnum.PAID` |
| 方法 | 动词开头 | `createOrder`、`queryOrderPage`、`updateOrderStatus` |
| 布尔字段 | 不用 `is` 前缀，避免 getter 序列化歧义 | `enabled`、`deleted` |

一个类只做一件事：出现 `OrderService` 里既有订单创建又有对账逻辑，说明该拆了。

## 四、接口契约

- 统一响应外壳 `Result<T>`（`code` / `message` / `data` / `traceId`），**禁止**直接返回 `String`、`Map`、裸实体。
- 错误码用 `ErrorCode` 枚举，6 位数字 + 中文消息；禁止在业务代码里抛裸数字码或临时字符串。
- 列表接口：入参 `PageQuery`（`page` / `pageSize`），出参 `PageResult<T>`（`list` / `total` / `page` / `pageSize` / `pages`），附加信息放 `extra`。
- 金额出参用字符串或「分」为单位的整数，避免前端浮点精度丢失。
- 时间统一 `yyyy-MM-dd HH:mm:ss`，时区 `Asia/Shanghai`；同一项目内不得一半时间戳一半字符串。
- 可选字段语义写清楚：查不到返回 `null` 还是空数组，必须在契约文档里定死。
- **接口变更先改契约，再改实现**：同步更新 `docs/API_CONTRACT.md` 与两端类型定义，保持单一来源。
- 写接口（支付、回调、审批、导入）必须支持幂等，幂等键或唯一索引兜底，见第十二节。

## 五、参数校验

- 用 `jakarta.validation` 注解在 DTO 上声明，禁止在 Controller 里堆 `if` 判断。
- 集合、字符串必须设上限（`@Size`），避免超大 payload。
- 分组校验用 `Create` / `Update` 分组接口，避免两个 DTO 复制粘贴。
- 校验消息用中文，且能指导用户（「手机号格式不正确」而不是「invalid」）。
- **业务校验放 Service**：例如「已支付的订单不能取消」属于业务规则，不属于格式校验。

```java
public record OrderCreateReq(
        @NotNull(message = "客户 ID 不能为空") Long customerId,
        @NotEmpty(message = "商品明细不能为空") @Size(max = 50, message = "单次最多 50 条明细") List<OrderItemReq> items,
        @Size(max = 200, message = "备注最多 200 字") String remark
) {
}
```

## 六、异常处理

- 全局 `@RestControllerAdvice` 统一兜底，转换 `Result`，不在每个接口里 `try-catch`。
- 业务异常用 `BizException(ErrorCode)`；禁止用 `RuntimeException("...")` 表达业务错误。
- **禁止吞异常**：`catch` 后什么都不做、或只 `printStackTrace`，一律视为缺陷。要么处理，要么包装后抛出。
- 日志级别：可预期的业务异常 `warn`（如参数不合法），不可预期的系统异常 `error` + 堆栈。
- 不把堆栈、SQL、类名返回给前端；返回 `traceId` 供排查。
- 补偿与重试逻辑必须幂等，且记录失败明细，禁止静默丢弃。

## 七、事务

- `@Transactional` 只加在 Service 的 public 方法上（private、自调用会失效）。
- 事务边界尽量小：**事务内禁止**远程调用、发消息、文件 IO、大批量循环。
- 明确写 `rollbackFor = Exception.class`，避免受检异常不回滚的坑。
- 只读查询用 `@Transactional(readOnly = true)`。
- 加超时（`timeout`）避免长事务拖垮连接池。
- 并发写入靠**条件更新或乐观锁**，不要用「先查后改」的写法：

```java
// 反例：并发下会覆盖别人的更新
Order order = orderMapper.selectById(id);
order.setStatus(PAID);
orderMapper.updateById(order);

// 正例：条件更新，返回 0 行说明状态已被别人改变
int updated = orderMapper.updateStatus(id, OrderStatusEnum.PAID, OrderStatusEnum.PENDING);
if (updated == 0) {
    throw new BizException(ErrorCode.ORDER_STATUS_CHANGED);
}
```

## 八、日志

- 统一 `@Slf4j`，禁止 `System.out.println`。
- 用占位符，不要字符串拼接：`log.info("订单状态变更 orderId={} from={} to={}", id, from, to)`。
- 关键入口出口各一条日志，包含耗时与 `traceId`。
- **禁止打印**：口令、Token、身份证号、完整手机号、银行卡号、完整报文；需要时脱敏后打印。
- 异常日志必须带上下文（谁、哪个订单、什么参数），否则等于没打。

## 九、数据访问（MyBatis-Plus）

- 禁止 `select *`；字段变化会让出参悄悄变形。
- 手写 SQL 一律用 `#{}`；`${}` 只允许用于白名单排序字段，且必须校验。
- 分页用插件，禁止查出全量再 `subList` 内存分页。
- 批量写入用 `saveBatch` 或批量 `insert`，禁止循环单条写。
- 列表页关联数据用「批量查询 + 内存组装」，避免 N+1。
- 逻辑删除默认带 `deleted = 0`；需要绕过时必须写明原因并加测试。
- 查询条件可空时用动态 SQL（`<if>`），禁止拼 `1=1` 之外的手工字符串拼接。

## 十、Spring Cloud 协作约定

| 关注点 | 约定 |
| --- | --- |
| 服务划分 | 按业务域拆；不按技术层拆成「查询服务 / 写入服务」 |
| 远程调用 | 只用 Feign 声明式客户端，禁止在业务代码里手写 HTTP |
| 超时 | 每个客户端必须显式配置连接与读取超时，不允许无限制等待 |
| 重试 | 只对**幂等**接口开启重试；非幂等接口禁止自动重试 |
| 降级 | 关键链路必须有降级或兜底提示，不允许直接抛技术异常给用户 |
| 传参 | 只传业务 ID 与必要字段；上游数据不可信，下游必须重新校验 |
| 鉴权 | 网关统一鉴权，内部接口仍需二次校验，不依赖「内网就是安全的」 |
| 配置 | 配置中心按环境隔离；密钥走配置中心加密或环境变量，禁止入库 |
| 分布式事务 | 不引入强一致分布式事务；用本地消息表 + 幂等消费实现最终一致 |
| 链路 | `traceId` 贯穿网关、服务、日志、返回体，便于定位 |

跨服务最终一致的标准做法：

1. 本地事务内写业务表 + 消息表（同库同事务），保证「业务成功必然有消息」。
2. 独立投递任务按消息表投递，失败重试并告警。
3. 消费方按业务唯一键幂等处理，重复消费结果一致。

## 十一、缓存

- key 命名带命名空间：`业务:实体:标识`，例如 `order:detail:123`；禁止裸 key。
- 必须设置过期时间，禁止永久 key（有明确理由时需在设计文档登记）。
- 更新策略统一 Cache-Aside：先更新数据库，再删除缓存。
- 穿透：空值缓存或布隆过滤器；雪崩：过期时间加随机抖动；击穿：热点 key 加互斥重建。
- 缓存不作为唯一数据源，任何「缓存没了数据就丢了」的设计都不允许。

## 十二、并发与幂等

- **唯一索引是幂等的最后一道防线**，不要只靠应用层「先查再插」。
- 分布式锁只用于降低并发压力，不能当作正确性保证（锁会失效、会超时）。
- 状态流转用状态机集中管理，禁止满屏 `if (status == 1)`。
- 定时任务多实例部署必须加锁或分片，避免重复执行。
- 线程池必须显式创建并命名，禁止 `Executors.newFixedThreadPool`（无界队列会 OOM）。

## 十三、测试

- 命名 `*Test.java`，覆盖正常、边界、异常三条路径。
- 列表与契约接口补 `*ContractTest`：分页结构、错误码、字段命名。
- 单元测试不依赖真实数据库与网络；集成测试用容器化数据库。
- **禁止对生产库跑测试**；测试数据用独立库或事务回滚。
- 断言错误码与消息，不只断言「不为空」。

## 十四、提交前自检

- [ ] `mvn test` 通过（项目统一入口以 `workflow.config.json` 的 `suggestedValidate` 为准）
- [ ] 无 `System.out.println`、无注释掉的代码、无未登记的 `TODO`
- [ ] 无硬编码口令、AppKey、测试账号
- [ ] 新增或变更接口已同步契约文档与前端类型
- [ ] 表结构变更已补迁移脚本（见 [数据库设计与建表规范](15-数据库设计与建表规范.md)）
- [ ] 日志无敏感信息
- [ ] 公共代码改动已按 `12-影响面与回归防护.md` 做过基线对比

## 十五、常见反模式

| 反模式 | 后果 | 正确做法 |
| --- | --- | --- |
| Controller 里写业务分支 | 无法复用与测试，事务边界混乱 | 下沉到 Service |
| 直接返回 Entity | 泄露内部字段，改表即改接口 | 用 VO 明确契约 |
| `catch (Exception e) {}` | 故障被静默吞掉 | 处理或包装后抛出并记日志 |
| 事务内调远程接口 | 连接被长时间占用，雪崩 | 事务外调用，或改为消息驱动 |
| 循环单条写库 | 批量场景性能坍塌 | 批量写入 |
| 用浮点存金额 | 对账差错 | `DECIMAL` 或整数分 |
| 状态字段随手 `set` | 状态错乱且无审计 | 状态机 + 条件更新 |
| 只在文档里写「待补测试」 | 需求变更后无人补 | 同一次提交内补齐 |
