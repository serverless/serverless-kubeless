# Remove volumeClaimTemplates from kafkaSts to enable testing kubeless
# on simple clusters deploys like kubeadm-dind-cluster
local kakfaZookeeper = import "kafka-zookeeper.jsonnet";
kakfaZookeeper + {
  controller+:
   { spec+: {template+: {spec+: {containers: [{imagePullPolicy: "IfNotPresent", name: "kafka-trigger-controller", image: std.extVar("controller_image")}] }}}},
  kafkaSts+:
    {spec+: {template+: {spec+: {volumes: [{name: "datadir", emptyDir: {}}]}}}},
  zookeeperSts+:
   {spec+: {template+: {spec+: {volumes: [{name: "datadir", emptyDir: {}}]}}}}
}