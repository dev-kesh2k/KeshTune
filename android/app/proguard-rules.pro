# Regras do R8 para o release. As bibliotecas (Retrofit, kotlinx.serialization, Room, Hilt, Media3, Coil)
# já trazem as suas próprias regras de consumo; aqui fica só o que é do app.

# Mantém arquivo e linha nos stack traces (lidos com o mapping.txt da versão publicada)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Sem keep amplo do pacote data. Se algum modelo falhar com SerializationException ou ClassCastException
# do Retrofit, adicionar um -keep,allowobfuscation só para ele.
