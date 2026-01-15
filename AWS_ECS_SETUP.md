# AWS ECS Fargate 部署指南

## 架构说明

- **ECS Fargate**: 无服务器容器运行
- **Application Load Balancer**: 负载均衡和 HTTPS
- **ECR**: 存储 Docker 镜像
- **GitHub Actions**: 自动化 CI/CD

## 前置要求

1. AWS 账号
2. AWS CLI 已配置
3. GitHub repository 设置完成

## 步骤 1: 创建 ECR 仓库

```bash
# 设置变量
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPOSITORY_NAME=debank-sign-api

# 创建 ECR 仓库
aws ecr create-repository \
  --repository-name $REPOSITORY_NAME \
  --region $AWS_REGION
```

## 步骤 2: 配置 GitHub OIDC Provider

### 2.1 创建 OIDC Provider (如果还没有)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2.2 创建 IAM Role

创建信任策略文件 `trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_USERNAME/debank-sign-api:*"
        }
      }
    }
  ]
}
```

**替换 YOUR_ACCOUNT_ID 和 YOUR_GITHUB_USERNAME**

创建 Role:

```bash
aws iam create-role \
  --role-name GitHubActionsECSDeployRole \
  --assume-role-policy-document file://trust-policy.json
```

### 2.3 附加权限策略

```bash
# ECR 权限
aws iam attach-role-policy \
  --role-name GitHubActionsECSDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

# ECS 权限
aws iam attach-role-policy \
  --role-name GitHubActionsECSDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
```

## 步骤 3: 创建 ECS 集群

```bash
aws ecs create-cluster \
  --cluster-name debank-sign-api-cluster \
  --region $AWS_REGION
```

## 步骤 4: 创建 VPC 和网络资源

### 4.1 获取默认 VPC (或创建新的)

```bash
# 获取默认 VPC
export VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" \
  --output text)

# 获取子网
export SUBNET_1=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[0].SubnetId" \
  --output text)

export SUBNET_2=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[1].SubnetId" \
  --output text)
```

### 4.2 创建安全组

```bash
# 创建 ALB 安全组
export ALB_SG=$(aws ec2 create-security-group \
  --group-name debank-sign-api-alb-sg \
  --description "Security group for ALB" \
  --vpc-id $VPC_ID \
  --query 'GroupId' \
  --output text)

# 允许 HTTP/HTTPS 入站
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# 创建 ECS 服务安全组
export ECS_SG=$(aws ec2 create-security-group \
  --group-name debank-sign-api-ecs-sg \
  --description "Security group for ECS tasks" \
  --vpc-id $VPC_ID \
  --query 'GroupId' \
  --output text)

# 允许来自 ALB 的流量
aws ec2 authorize-security-group-ingress \
  --group-id $ECS_SG \
  --protocol tcp \
  --port 8899 \
  --source-group $ALB_SG
```

## 步骤 5: 创建 Application Load Balancer

```bash
# 创建 ALB
export ALB_ARN=$(aws elbv2 create-load-balancer \
  --name debank-sign-api-alb \
  --subnets $SUBNET_1 $SUBNET_2 \
  --security-groups $ALB_SG \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text)

# 创建目标组
export TG_ARN=$(aws elbv2 create-target-group \
  --name debank-sign-api-tg \
  --protocol HTTP \
  --port 8899 \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path /sign \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

# 创建监听器
aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN
```

## 步骤 6: 创建 ECS Task Execution Role

```bash
# 创建信任策略
cat > ecs-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# 创建 Role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file://ecs-trust-policy.json

# 附加策略
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

## 步骤 7: 创建 CloudWatch Logs 组

```bash
aws logs create-log-group \
  --log-group-name /ecs/debank-sign-api \
  --region $AWS_REGION
```

## 步骤 8: 注册 Task Definition

创建 `task-definition.json`:

```json
{
  "family": "debank-sign-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "debank-sign-api",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/debank-sign-api:latest",
      "portMappings": [
        {
          "containerPort": 8899,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/debank-sign-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ]
    }
  ]
}
```

**替换 YOUR_ACCOUNT_ID**

注册 Task Definition:

```bash
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json
```

## 步骤 9: 创建 ECS 服务

```bash
aws ecs create-service \
  --cluster debank-sign-api-cluster \
  --service-name debank-sign-api-service \
  --task-definition debank-sign-api \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=debank-sign-api,containerPort=8899"
```

## 步骤 10: 配置 GitHub Secrets

在 GitHub repository 的 Settings > Secrets and variables > Actions 中添加:

- **AWS_ROLE_ARN**: `arn:aws:iam::YOUR_ACCOUNT_ID:role/GitHubActionsECSDeployRole`

## 步骤 11: 手动首次部署

```bash
# 构建并推送镜像
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker build -t debank-sign-api .
docker tag debank-sign-api:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/debank-sign-api:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/debank-sign-api:latest
```

## 步骤 12: 获取 ALB DNS 并测试

```bash
# 获取 ALB DNS
export ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

echo "API endpoint: http://$ALB_DNS/sign?address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"

# 测试
curl "http://$ALB_DNS/sign?address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

## 成本估算

- **ECS Fargate**: 0.5 vCPU + 1 GB = ~$14/月
- **ALB**: ~$18/月
- **ECR**: 存储 ~$0.10/月
- **总计**: ~$32/月

对于低流量，可以考虑：
- 使用更小的配置 (0.25 vCPU + 0.5 GB) = ~$7/月
- 或者改用 App Runner (~$5/月)

## 监控

查看日志:
```bash
aws logs tail /ecs/debank-sign-api --follow
```

## 清理资源

```bash
# 删除服务
aws ecs update-service \
  --cluster debank-sign-api-cluster \
  --service debank-sign-api-service \
  --desired-count 0

aws ecs delete-service \
  --cluster debank-sign-api-cluster \
  --service debank-sign-api-service

# 删除集群
aws ecs delete-cluster --cluster debank-sign-api-cluster

# 删除 ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
aws elbv2 delete-target-group --target-group-arn $TG_ARN

# 删除安全组
aws ec2 delete-security-group --group-id $ALB_SG
aws ec2 delete-security-group --group-id $ECS_SG

# 删除 ECR
aws ecr delete-repository --repository-name debank-sign-api --force
```
