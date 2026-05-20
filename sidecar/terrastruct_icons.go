package main

import (
	"net/url"
	"strings"
)

type terrastructIcon struct {
	Label    string
	Category string
	Path     string
	Aliases  []string
}

var terrastructIcons = []terrastructIcon{
	{Label: "AWS Cloud", Category: "aws", Path: "_Group Icons/AWS-Cloud-alt_light-bg.svg", Aliases: []string{"amazon web services group"}},
	{Label: "AWS EC2", Category: "aws", Path: "Compute/Amazon-EC2.svg", Aliases: []string{"amazon elastic compute compute instance server"}},
	{Label: "AWS EC2 Instance Container", Category: "aws", Path: "_Group Icons/EC2-instance-container_light-bg.svg", Aliases: []string{"amazon compute instance group"}},
	{Label: "AWS Lambda", Category: "aws", Path: "Compute/AWS-Lambda_Lambda-Function_light-bg.svg", Aliases: []string{"amazon serverless function compute"}},
	{Label: "AWS S3", Category: "aws", Path: "Storage/Amazon-Simple-Storage-Service-S3.svg", Aliases: []string{"amazon storage bucket object"}},
	{Label: "AWS RDS", Category: "aws", Path: "Database/Amazon-RDS_light-bg.svg", Aliases: []string{"amazon relational database sql"}},
	{Label: "AWS DynamoDB", Category: "aws", Path: "Database/Amazon-DynamoDB_light-bg.svg", Aliases: []string{"amazon nosql database"}},
	{Label: "AWS VPC", Category: "aws", Path: "_Group Icons/Virtual-private-cloud-VPC_light-bg.svg", Aliases: []string{"amazon network networking virtual private cloud"}},
	{Label: "AWS API Gateway", Category: "aws", Path: "Networking & Content Delivery/Amazon-API-Gateway.svg", Aliases: []string{"amazon api network"}},
	{Label: "AWS CloudFront", Category: "aws", Path: "Networking & Content Delivery/Amazon-CloudFront_light-bg.svg", Aliases: []string{"amazon cdn edge network"}},
	{Label: "AWS Route 53", Category: "aws", Path: "Networking & Content Delivery/Amazon-Route-53_light-bg.svg", Aliases: []string{"amazon dns network"}},
	{Label: "AWS ECS", Category: "aws", Path: "Compute/Amazon-Elastic-Container-Service_light-bg.svg", Aliases: []string{"amazon container compute"}},
	{Label: "AWS EKS", Category: "aws", Path: "Compute/Amazon-Elastic-Kubernetes-Service_light-bg.svg", Aliases: []string{"amazon kubernetes container compute"}},
	{Label: "AWS SNS", Category: "aws", Path: "Application Integration/Amazon-Simple-Notification-Service-SNS_light-bg.svg", Aliases: []string{"amazon notification pubsub messaging"}},
	{Label: "AWS SQS", Category: "aws", Path: "Application Integration/Amazon-Simple-Queue-Service-SQS_light-bg.svg", Aliases: []string{"amazon queue messaging"}},
	{Label: "AWS IAM", Category: "aws", Path: "Security, Identity, & Compliance/AWS-Identify-and-Access-Management_IAM.svg", Aliases: []string{"amazon security identity access"}},

	{Label: "Azure App Service", Category: "azure", Path: "Web Service Color/App Services.svg", Aliases: []string{"microsoft web service"}},
	{Label: "Azure App Service Domains", Category: "azure", Path: "Web Service Color/App Service Domains.svg", Aliases: []string{"microsoft web dns domain"}},
	{Label: "Azure Functions", Category: "azure", Path: "Compute Service Color/Function Apps.svg", Aliases: []string{"microsoft serverless compute"}},
	{Label: "Azure Kubernetes Service", Category: "azure", Path: "Container Service Color/Kubernetes Services.svg", Aliases: []string{"microsoft aks container"}},
	{Label: "Azure SQL Database", Category: "azure", Path: "Databases Service Color/SQL Databases.svg", Aliases: []string{"microsoft sql database"}},
	{Label: "Azure Cosmos DB", Category: "azure", Path: "Databases Service Color/Azure Cosmos DB.svg", Aliases: []string{"microsoft nosql database"}},
	{Label: "Azure Storage Accounts", Category: "azure", Path: "Storage Service Color/Storage Accounts.svg", Aliases: []string{"microsoft blob file storage"}},

	{Label: "GCP Cloud", Category: "gcp", Path: "Products and services/Networking/Cloud Network.svg", Aliases: []string{"google cloud platform"}},
	{Label: "GCP Compute Engine", Category: "gcp", Path: "Products and services/Compute/Compute Engine.svg", Aliases: []string{"google vm compute server"}},
	{Label: "GCP Cloud Functions", Category: "gcp", Path: "Products and services/Compute/Cloud Functions.svg", Aliases: []string{"google serverless compute"}},
	{Label: "GCP Cloud Run", Category: "gcp", Path: "Products and services/Compute/Cloud Run.svg", Aliases: []string{"google container serverless"}},
	{Label: "GCP Kubernetes Engine", Category: "gcp", Path: "Products and services/Compute/Kubetnetes Engine.svg", Aliases: []string{"google gke container"}},
	{Label: "GCP Cloud SQL", Category: "gcp", Path: "Products and services/Databases/Cloud SQL.svg", Aliases: []string{"google database sql"}},
	{Label: "GCP BigQuery", Category: "gcp", Path: "Products and services/Data Analytics/BigQuery.svg", Aliases: []string{"google analytics data warehouse"}},
	{Label: "GCP Cloud Storage", Category: "gcp", Path: "Products and services/Storage/Cloud Storage.svg", Aliases: []string{"google bucket object storage"}},

	{Label: "GitHub", Category: "dev", Path: "github.svg", Aliases: []string{"git repository actions source control"}},
	{Label: "GitLab", Category: "dev", Path: "gitlab.svg", Aliases: []string{"git repository ci source control"}},
	{Label: "Docker", Category: "dev", Path: "docker.svg", Aliases: []string{"container image"}},
	{Label: "PostgreSQL", Category: "dev", Path: "postgresql.svg", Aliases: []string{"postgres database sql"}},
	{Label: "MySQL", Category: "dev", Path: "mysql.svg", Aliases: []string{"database sql"}},
	{Label: "MongoDB", Category: "dev", Path: "mongodb.svg", Aliases: []string{"database nosql document"}},
	{Label: "Redis", Category: "dev", Path: "redis.svg", Aliases: []string{"cache database queue"}},
	{Label: "Nginx", Category: "dev", Path: "nginx.svg", Aliases: []string{"proxy web server"}},
	{Label: "Node.js", Category: "dev", Path: "nodejs.svg", Aliases: []string{"javascript runtime"}},
	{Label: "React", Category: "dev", Path: "react.svg", Aliases: []string{"frontend javascript ui"}},
	{Label: "TypeScript", Category: "dev", Path: "typescript.svg", Aliases: []string{"javascript language"}},
	{Label: "JavaScript", Category: "dev", Path: "javascript.svg", Aliases: []string{"js language"}},
	{Label: "Go", Category: "dev", Path: "go.svg", Aliases: []string{"golang language"}},
	{Label: "Python", Category: "dev", Path: "python.svg", Aliases: []string{"language"}},
	{Label: "Rust", Category: "dev", Path: "rust.svg", Aliases: []string{"language"}},
	{Label: "Java", Category: "dev", Path: "java.svg", Aliases: []string{"language jvm"}},
	{Label: "PHP", Category: "dev", Path: "php.svg", Aliases: []string{"language"}},
	{Label: "Ruby", Category: "dev", Path: "ruby.svg", Aliases: []string{"language rails"}},
	{Label: "Linux", Category: "dev", Path: "linux.svg", Aliases: []string{"operating system server"}},
	{Label: "Ubuntu", Category: "dev", Path: "ubuntu.svg", Aliases: []string{"linux operating system"}},
	{Label: "Slack", Category: "dev", Path: "slack.svg", Aliases: []string{"chat collaboration"}},

	{Label: "Network", Category: "infra", Path: "019-network.svg", Aliases: []string{"infrastructure lan"}},
	{Label: "Global Network", Category: "infra", Path: "040-global network.svg", Aliases: []string{"internet globe"}},
	{Label: "Firewall", Category: "infra", Path: "003-firewall.svg", Aliases: []string{"security network"}},
	{Label: "Data Storage", Category: "infra", Path: "011-data-storage.svg", Aliases: []string{"database disk"}},
	{Label: "Data Sharing", Category: "infra", Path: "010-data-sharing.svg", Aliases: []string{"sync transfer"}},
	{Label: "Backup", Category: "infra", Path: "002-backup.svg", Aliases: []string{"restore archive"}},
	{Label: "Protection", Category: "infra", Path: "033-protection.svg", Aliases: []string{"security shield"}},
	{Label: "Hardware", Category: "infra", Path: "021-hardware.svg", Aliases: []string{"server device"}},
	{Label: "Hosting", Category: "infra", Path: "022-hosting.svg", Aliases: []string{"server cloud"}},
	{Label: "Transfer", Category: "infra", Path: "013-transfer.svg", Aliases: []string{"network data"}},

	{Label: "Picture", Category: "essentials", Path: "004-picture.svg", Aliases: []string{"image media"}},
	{Label: "Server", Category: "essentials", Path: "112-server.svg", Aliases: []string{"compute machine"}},
	{Label: "Database", Category: "essentials", Path: "089-data analysis.svg", Aliases: []string{"data analytics"}},
	{Label: "Users", Category: "essentials", Path: "359-users.svg", Aliases: []string{"people team"}},
	{Label: "Analytics", Category: "essentials", Path: "001-analytics.svg", Aliases: []string{"metrics chart"}},
	{Label: "Calendar", Category: "essentials", Path: "273-calendar.svg", Aliases: []string{"date schedule"}},

	{Label: "Twitter", Category: "social", Path: "013-twitter-1.svg", Aliases: []string{"x social"}},
}

func terrastructIconCompletions() []completionItem {
	items := make([]completionItem, 0, len(terrastructIcons))
	for _, icon := range terrastructIcons {
		url := terrastructIconURL(icon.Category, icon.Path)
		filterParts := []string{icon.Label, icon.Category, icon.Path}
		filterParts = append(filterParts, icon.Aliases...)
		items = append(items, completionItem{
			Label:         icon.Label,
			Kind:          "icon",
			Detail:        "Terrastruct icon",
			Description:   strings.ToUpper(icon.Category),
			Documentation: "Terrastruct hosted icon\n\n" + url,
			InsertText:    url,
			FilterText:    strings.Join(filterParts, " "),
		})
	}
	return items
}

func terrastructIconURL(category, path string) string {
	return "https://icons.terrastruct.com/" + url.PathEscape(category+"/"+path)
}
