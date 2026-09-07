class Vehicle:
    def __init__(self,no_of_wheels,no_of_people_carry):
        self.no_of_wheels=no_of_wheels
        self.no_of_people_carry=no_of_people_carry

    def category(self):
        return f"This vehicle can carry {self.no_of_people_carry} and it has {self.no_of_wheels}"




class Car(Vehicle):
    def __init__(self,name,color,model,registered_on,no_of_wheels,no_of_people_carry):
        self.name=name
        self.color=color
        self.model=model
        self.registered_on=registered_on
        Vehicle.__init__(self,no_of_wheels,no_of_people_carry)

    def Drive(self):
        return f"""I am driving {self.name}, model:{self.model},
          color: {self.color} and it was registered on {self.registered_on}.
          It has {self.no_of_wheels} and {self.no_of_people_carry}
        """


v1=Vehicle(2,5)



c1=Car("civic","black","reborn","2022-01-01",2,5)

print(c1.model)
print(c1.registered_on)
print(c1.Drive())
print(c1.category())