# Remove volumeClaimTemplates from kafkaSts to enable testing kubeless
# on simple clusters deploys like kubeadm-dind-cluster
local kubeless = import "kubeless.jsonnet";
kubeless + {
  controller+:
   { spec+: {template+: {spec+: {containers: [{imagePullPolicy: "IfNotPresent", name: "kubeless-controller", image: std.extVar("controller_image")}] }}}},
  kafkaSts+:
   {spec+: {volumeClaimTemplates: []}} +
   {spec+: {template+: {spec+: {volumes: [{name: "datadir", emptyDir: {}}]}}}}
}