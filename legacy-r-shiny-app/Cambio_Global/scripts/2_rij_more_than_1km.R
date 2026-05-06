library(exactextractr)
library(fst)
library(raster)
library(openxlsx)
library(sf)
library(dplyr)
library(doParallel)
source("C:/Clouds/OneDrive - The Nature Conservancy/Common_Scripts/R/Defing groups for parallelizing.R")

extension="Nacional"
resolution="3km"
setwd("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global")

PUs_p=read_sf((paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/PUs/PUS_",extension,"_",resolution,".shp")))
features=read.xlsx("./input/features_v4_4_24_(MAPV).xlsx")
features=features[-which(features$id_original == 0),]
features=features[features$id_elemento_priorizacion != 20,]
unique_features=read.xlsx("./input/scenarios_to_run_v4_4_24_JBG.xlsx")
#unique_features=unique_features[unique_features$SIRAP==extension,]
unique_features=unique_features$id_elemento_priorizacion
unique_features=paste(unique_features,collapse=',')
unique_features=sort(unique(as.numeric(strsplit(unique_features, ",")[[1]])))
features=features[features$id_elemento_priorizacion %in% unique_features,]
cat_by_layer=as.data.frame(features %>% group_by(archivo) %>% summarise(count=n(),sum=sum(id_original)))
cat_by_layer=merge(cat_by_layer,distinct(features[,c("archivo","id_elemento_priorizacion")]),by="archivo",all.x=T)
gc(reset = T)

#### ONE CATEGORY LAYERS ####

files=cat_by_layer %>% filter(count==1 & sum==1) %>% select (archivo)
files=files$archivo
if (length(files)==0){
  rij_cat1=data.frame(pu=integer(),species=integer(),amount=integer())
} else {
  n_cores=ifelse(length(files)<detectCores(),length(files),detectCores())
  #n_cores=14
  groups=groups_for_parallelizing(length(files),n_cores)
  rm("unique_features")
  cl=makeCluster(n_cores,type="PSOCK")
  registerDoParallel(cl,cores=n_cores)
  rij_cat1=foreach(j=1:length(groups),.inorder=F,.packages=c("exactextractr","raster","fst","dplyr"),
                   .noexport = c("cat_by_layer","cl","extension","n_cores","resolution"),
                   .verbose=T,.combine=rbind.data.frame,.errorhandling="remove") %dopar%{
                     result=data.frame(pu=integer(),species=integer(),amount=integer())
                     raster_files=files[groups[[j]]]
                     for(i in raster_files){
                       df=raster(i)
                       df[df!=1]=NA
                       df=exact_extract(df, PUs_p, fun='sum')
                       gc(reset = T)
                       df=data.frame(pu=PUs_p$Id, species=features[features$archivo==i,"id"], amount=df)
                       df=df %>% filter(amount>0.1)
                       gc(reset = T)
                       result=rbind.data.frame(result,df)
                       write.fst(result,paste0("./input/rij_cat1_group_",j,".fst"),100)
                       gc(reset = T)
                     }
                     return(result)
                   }
  stopCluster(cl)
  gc(reset = T)
  rij_cat1=rij_cat1 %>% filter(amount>=1)
  summary(rij_cat1)
  write_fst(rij_cat1,"./input/rij_cat1.fst",100)
}

#### MULTIPLE CATEGORY LAYERS ####

files=cat_by_layer[cat_by_layer$count>1,"archivo"]
if (length(files)==0){
  rij_cat2=data.frame(pu=integer(),species=integer(),amount=integer())
} else {
  n_cores=ifelse(length(files)<detectCores(),length(files),detectCores())
  groups=groups_for_parallelizing(length(files),n_cores)
  cl=makeCluster(n_cores,type="PSOCK")
  registerDoParallel(cl,cores=n_cores)
  rij_cat2=foreach(j=1:length(groups),.inorder=F,.packages=c("exactextractr","raster","fst","dplyr"),
                   .noexport = c("cat_by_layer","cl","extension","n_cores","resolution","rij_cat1"),
                   .verbose=T,.combine=rbind.data.frame,.errorhandling="remove") %dopar%{
                     result=data.frame(pu=integer(),species=integer(),amount=integer())
                     raster_files=files[groups[[j]]]
                     for(i in raster_files){
                       df=raster(i)
                       df=exact_extract(df, PUs_p, include_cols="Id")
                       gc(reset = T)
                       df=do.call(rbind.data.frame, df)
                       gc(reset = T)
                       df=df %>% filter(!is.na(value))
                       gc(reset = T)
                       df=as.data.frame(df %>% group_by(Id,value) %>% summarise(amount = sum(coverage_fraction)))
                       gc(reset = T)
                       df=df %>% filter(amount>0.1)
                       gc(reset = T)
                       colnames(df)[1:2]=c("pu","id_original")
                       df$pu=as.numeric(df$pu)
                       df=merge(df,features[features$archivo==i,c("id","id_original")],by="id_original",all.x=T)
                       gc(reset = T)
                       df=data.frame(pu=df$pu, species=df$id, amount=df$amount)
                       gc(reset = T)
                       result=rbind.data.frame(result,df)
                       write.fst(result,paste0("./input/rij_cat2_group_",j,".fst"),100)
                       gc(reset = T)
                     }
                     return(result)
                   }
  stopCluster(cl)
  gc(reset = T)
  rij_cat2=rij_cat2 %>% filter(amount>=1)
  summary(rij_cat2)
  write_fst(rij_cat2,"./input/rij_cat2.fst",100)
}

#### NUMERIC LAYERS ####

files=cat_by_layer[is.na(cat_by_layer$sum),"archivo"]
if (length(files)==0){
  rij_num=data.frame(pu=integer(),species=integer(),amount=integer())
} else {
  n_cores=ifelse(length(files)<detectCores(),length(files),detectCores())
  groups=groups_for_parallelizing(length(files),n_cores)
  cl=makeCluster(n_cores,type="PSOCK")
  registerDoParallel(cl,cores=n_cores)
  rij_num=foreach(j=1:length(groups),.inorder=F,.packages=c("exactextractr","raster","fst","dplyr"),
                  .noexport = c("cat_by_layer","cl","extension","n_cores","resolution","rij_cat1","rij_cat2","groups_for_parallelizing"),
                  .verbose=T,.combine=rbind.data.frame,.errorhandling="remove") %dopar%{
                    result=data.frame(pu=integer(),species=integer(),amount=integer())
                    raster_files=files[groups[[j]]]
                    for(i in raster_files){
                      df=raster(i)
                      df=exact_extract(df, PUs_p, fun='mean')
                      gc(reset = T)
                      df=data.frame(pu=PUs_p$Id, species=features[features$archivo==i,"id"], amount=df)
                      df=df %>% filter(amount>0)
                      gc(reset = T)
                      result=rbind.data.frame(result,df)
                      write.fst(result,paste0("./input/rij_num_group_",j,".fst"),100)
                      gc(reset = T)
                    }
                    return(result)
                  }
  stopCluster(cl)
  gc(reset = T)
  rij_num=rij_num %>% filter(amount>0)
  summary(rij_num)
  write_fst(rij_num,"./input/rij_num.fst",100)
}

#### MERGE RIJs ####

rij=rbind.data.frame(rij_cat1,rij_cat2,rij_num)
rij$pu=as.numeric(rij$pu)
rij=arrange(rij,species,pu)
summary(rij)
gc(reset = T)
rij_nas=rij[is.na(rij$species),]
gc(reset = T)
rij_max=rij[rij$amount>9.01,]
unique(rij_max$species)
unique(rij_num$species)
gc(reset = T)
if(nrow(rij_nas=0)){
  write_fst(rij,paste0("./input/rij_",extension,"_",resolution,".fst"),100)
} else{
  write_fst(rij[!is.na(rij$species),],paste0("./input/rij_",extension,"_",resolution,".fst"),100)
}
gc(reset = T)
