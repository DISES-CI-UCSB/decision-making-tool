library(doParallel)
library(fst)
library(dplyr)

files=list.files("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input",".fst",full.names=T)
n_cores=ifelse(detectCores()<length(files),detectCores(),length(files))
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
rij=foreach(i=1:length(files),.inorder=F,.verbose=T,.packages="fst",.combine=rbind.data.frame) %dopar%{
  result=read.fst(files[i])
  bad_ids=unique(result$species[result$amount!=1])
  if(length(bad_ids)>0){
    result=result[-which(result$species %in% bad_ids),]
  }
  return(result)
  gc()
} 
stopCluster(cl)
gc()
rij = rij %>% distinct()
gc(reset = T, full = T)
write_fst(rij,"D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/rij_merged_all_PUs.fst",100)

# pu_ids=read.csv("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/PUS_EJE_CAFETERO.csv")
# #rij=rij[rij$pu %in% pu_ids$id,]
# rij=read.fst("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/rij_EJE_CAFETERO_all_PUs.fst")
# 
# rij=rij %>% filter(pu %in% pu_ids$id)
# gc(reset = T, full = T)
# write_fst(rij,"D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/rij_merged.fst",100)
