library(doParallel)
library(openxlsx)

features=read.xlsx("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/features_v4_4_24_for_copy_files.xlsx")
features=features[features$id_elemento_priorizacion != 20,]

folders=unique(features$id_elemento_priorizacion)
for(i in folders){
  dir.create(paste0("D:/Box/Proyectos_JBG/mesa_prioridades/features/",i))
}

files=unique(features[,c("id_elemento_priorizacion","archivo")])
n_cores=ifelse(detectCores()<length(files),detectCores(),length(files))

cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
foreach(i=1:nrow(files),.inorder=F,.verbose=T,.noexport=ls(),.export=c("files")) %dopar%{
  file.copy(files$archivo[i],
            paste0("D:/Box/Proyectos_JBG/mesa_prioridades/features/",files$id_elemento_priorizacion[i]))
  gc()
}
stopCluster(cl)
gc()